Chassis_type = "Monocorque"
class Car: #This is the class defenition
  def __init__(self,brand,color,transmission="AT"): #Constructor to the class Initialization function - Gets the input the user 
    #Keyword Self tells me that this is part of the class
    self.brand = brand
    self.color = color 
    self.transmission = transmission

  def honk(self,times):
    for i in range(times): 
      print(f"{self.color} {self.brand} says: HONK!!!")
      print(f"The Car is of type {Chassis_type}")

  def Transmission(self):
    print(f"{self.brand} Transmission: {self.transmission}!!!")
  
  def fun1(self):
    pass

  def fun2(self):
    pass
