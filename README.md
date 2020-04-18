# Domotica with OpenZWave
This repository contains a NodeJS script that can read a ZWave signal from a special switch which is also a power meter.

# Installing on Ubuntu 18.04
Make sure node is installed.

## Download and compile Open-Zwave library
#### Get the unix source at http://old.openzwave.com/downloads/ (tested with openzwave-1.6.1072.tar.gz)
```
wget http://old.openzwave.com/downloads/openzwave-<version>.tar.gz
```

#### Untar
```
tar zxvf openzwave-*.gz
```

#### Compile Open-Zwave
```
cd openzwave-*
make && sudo make install
```

#### Update the environment variable
```
export LD_LIBRARY_PATH=/usr/local/lib64
```
make it permanent by adding it to /etc/environment
```
sudo sed -i '$a LD_LIBRARY_PATH=/usr/local/lib64' /etc/environment
```
At this step you can ensure Open-Zwave library is correctly installed with
```
MinOZW
```
