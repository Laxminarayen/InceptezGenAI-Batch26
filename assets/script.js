(function () {
  const searchBox = document.getElementById("search-box");
  const cards = Array.from(document.querySelectorAll(".card"));
  const groupSections = Array.from(document.querySelectorAll(".group-section"));
  const navLinks = Array.from(document.querySelectorAll(".nav-link[data-target]"));

  if (searchBox) {
    searchBox.addEventListener("input", () => {
      const q = searchBox.value.trim().toLowerCase();
      cards.forEach((card) => {
        const haystack = card.dataset.search || "";
        card.classList.toggle("is-hidden", q.length > 0 && !haystack.includes(q));
      });
      groupSections.forEach((section) => {
        const visible = section.querySelectorAll(".card:not(.is-hidden)").length;
        section.style.display = q.length > 0 && visible === 0 ? "none" : "";
      });
    });
  }

  if (navLinks.length) {
    const targets = navLinks
      .map((link) => document.getElementById(link.dataset.target))
      .filter(Boolean);

    const setActive = (id) => {
      navLinks.forEach((link) => {
        link.classList.toggle("active", link.dataset.target === id);
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          }
        });
      },
      { rootMargin: "-10% 0px -70% 0px", threshold: 0 }
    );

    targets.forEach((el) => observer.observe(el));
  }
})();
