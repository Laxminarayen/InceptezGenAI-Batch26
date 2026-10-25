import os 

import torch 
from torch import nn


MODEL_PATH = os.path.join(os.path.dirname(__file__), "salary_net.pth")

class SalaryNet(nn.Module):
  def __init__(self):
    super().__init__()
    self.hidden = nn.Linear(in_features = 1, out_features = 2)#input is X output h1 and h2
    self.relu = nn.ReLU()
    self.output = nn.Linear(2,1)
  
  def forward(self,x):
    h = self.hidden(x) #weighted Sum Z 
    h = self.relu(h) #Activation
    salary = self.output(h)
    return salary

def load_model(path: str = MODEL_PATH):
  model = SalaryNet()
  model.load_state_dict(torch.load(path,map_location=torch.device('cpu')))
  model.eval()
  return model