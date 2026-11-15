import torch.nn as nn

class CatDogCNN(nn.Module):
  def __init__(self):
    super().__init__()
    self.network = nn.Sequential(
        nn.Conv2d(in_channels=3, out_channels=16, kernel_size=3, padding=1),
        nn.ReLU(),
        nn.MaxPool2d(kernel_size=2),

        nn.Conv2d(in_channels=16, out_channels=32, kernel_size=3, padding=1),
        nn.ReLU(),
        nn.MaxPool2d(kernel_size=2),

        nn.Conv2d(in_channels=32, out_channels=64, kernel_size=3, padding=1),
        nn.ReLU(),
        nn.MaxPool2d(kernel_size=2),

        nn.AdaptiveAvgPool2d((4,4)),
        nn.Flatten(),
        nn.Linear(in_features=64*4*4, out_features=32),
        nn.ReLU(),
        nn.Linear(in_features=32, out_features=2),)

  def forward(self, x):
    return self.network(x)