"""
Regenerates the Projects-tab hackathon datasets (Banking + Industry).

Downloads the two UCI source datasets, builds a stratified train / public-test /
private-test split, and writes:
  - data/projects/<name>/train.csv            (public — has labels)
  - data/projects/<name>/test.csv              (public — no labels, id column added)
  - data/projects/<name>/sample_submission.csv (public — correct format, baseline filled in)
  - worker/private-data/answerkey_<name>.json  (PRIVATE — gitignored, holds the true
                                                 labels + public/private fold per id)

Run from anywhere with: python3 worker/scripts/build_hackathon_datasets.py
Requires: pandas, scikit-learn (both already used in this course).

After running, re-seed the answer keys into Cloudflare KV — see worker/README.md
("Hackathon leaderboards" section) for the wrangler commands.
"""

import io
import json
import zipfile
from pathlib import Path

import pandas as pd
import requests
from sklearn.model_selection import train_test_split

RANDOM_STATE = 26  # Batch 26 :)

REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DIR = REPO_ROOT / "data" / "projects"
PRIVATE_DIR = REPO_ROOT / "worker" / "private-data"
PRIVATE_DIR.mkdir(parents=True, exist_ok=True)

BANK_ZIP_URL = "https://archive.ics.uci.edu/static/public/222/bank+marketing.zip"
ROOM_ZIP_URL = "https://archive.ics.uci.edu/static/public/864/room+occupancy+estimation.zip"


def fetch_zip(url):
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return zipfile.ZipFile(io.BytesIO(resp.content))


def load_bank_marketing():
    outer = fetch_zip(BANK_ZIP_URL)
    inner_bytes = outer.read("bank.zip")
    inner = zipfile.ZipFile(io.BytesIO(inner_bytes))
    with inner.open("bank-full.csv") as f:
        return pd.read_csv(f, sep=";")


def load_room_occupancy():
    z = fetch_zip(ROOM_ZIP_URL)
    with z.open("Occupancy_Estimation.csv") as f:
        return pd.read_csv(f)


def make_project(name, df, target_col, feature_cols, id_prefix, test_size=0.20, public_frac=0.30):
    out_dir = PUBLIC_DIR / name
    out_dir.mkdir(parents=True, exist_ok=True)

    df = df.reset_index(drop=True).copy()
    y = df[target_col]

    train_df, test_df = train_test_split(df, test_size=test_size, random_state=RANDOM_STATE, stratify=y)

    test_y = test_df[target_col]
    public_df, private_df = train_test_split(
        test_df, test_size=(1 - public_frac), random_state=RANDOM_STATE, stratify=test_y
    )
    public_df = public_df.copy()
    private_df = private_df.copy()
    public_df["__fold"] = "public"
    private_df["__fold"] = "private"

    test_all = pd.concat([public_df, private_df], axis=0)
    test_all = test_all.sample(frac=1.0, random_state=RANDOM_STATE + 1).reset_index(drop=True)
    ids = [f"{id_prefix}-{i + 1:05d}" for i in range(len(test_all))]
    test_all.insert(0, "id", ids)

    train_df[feature_cols + [target_col]].reset_index(drop=True).to_csv(out_dir / "train.csv", index=False)
    test_all[["id"] + feature_cols].reset_index(drop=True).to_csv(out_dir / "test.csv", index=False)

    majority_class = train_df[target_col].mode().iloc[0]
    pd.DataFrame({"id": test_all["id"], "prediction": majority_class}).to_csv(
        out_dir / "sample_submission.csv", index=False
    )

    answer_key = {
        row["id"]: {"label": str(row[target_col]), "fold": row["__fold"]} for _, row in test_all.iterrows()
    }
    with open(PRIVATE_DIR / f"answerkey_{name}.json", "w") as f:
        json.dump(answer_key, f)

    print(f"{name}: train={len(train_df)} test={len(test_all)} public={len(public_df)} private={len(private_df)}")


def main():
    bank = load_bank_marketing()
    bank_features = [c for c in bank.columns if c != "y"]
    make_project("banking", bank, "y", bank_features, id_prefix="BANK")

    room = load_room_occupancy()
    room_features = [c for c in room.columns if c != "Room_Occupancy_Count"]
    make_project("industry", room, "Room_Occupancy_Count", room_features, id_prefix="ROOM")


if __name__ == "__main__":
    main()
