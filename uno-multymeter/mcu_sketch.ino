/*
  UNO Q - Real-time Current/Voltage Monitor (MCU side)
  ------------------------------------------------------
  Runs on the STM32U585 (MCU / Zephyr side).
  Reads an INA226 current/voltage sensor over I2C (via the
  Qwiic connector) and exposes the latest readings to the
  Linux (MPU) side through the Arduino Bridge.

  Libraries needed (install via Arduino Library Manager):
    - Adafruit INA226
    - Adafruit BusIO (dependency)
    - Arduino_RouterBridge (comes with UNO Q core)
*/

#include <Arduino_RouterBridge.h>
#include <Wire.h>
#include <Adafruit_INA226.h>

Adafruit_INA226 ina226;

volatile float g_current_mA = 0;
volatile float g_voltage_V  = 0;
volatile float g_power_mW   = 0;

// --- Functions exposed to the Linux/Node.js side ---
// Keep each one simple (single primitive return) - this matches
// the pattern Arduino's own Bridge examples use and is the most
// reliable across RouterBridge versions.
float getCurrent_mA() { return g_current_mA; }
float getVoltage_V()  { return g_voltage_V; }
float getPower_mW()   { return g_power_mW; }

void setup() {
  Wire.begin();

  if (!ina226.begin(0x40)) {
    // If this fails, check wiring / I2C address (0x40 is default)
    while (1) { delay(1000); }
  }

  // Fast conversion time = higher effective sample rate on this side
  ina226.setAveragingCount(INA226_COUNT_1);
  ina226.setBusVoltageConversionTime(INA226_TIME_140_us);
  ina226.setCurrentConversionTime(INA226_TIME_140_us);

  Bridge.begin();
  Bridge.provide_safe("get_current_mA", getCurrent_mA);
  Bridge.provide_safe("get_voltage_V", getVoltage_V);
  Bridge.provide_safe("get_power_mW", getPower_mW);
}

void loop() {
  g_current_mA = ina226.getCurrent_mA();
  g_voltage_V  = ina226.getBusVoltage_V();
  g_power_mW   = ina226.getPower_mW();

  delay(5); // ~200Hz internal sample rate on the MCU side
}
