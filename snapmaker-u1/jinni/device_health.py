"""The U1's device-realm failure diagnosis.

Recognise a NON-plugin cause the safety net must report instead of blaming a plugin, and emit a
machine TOKEN for it (ADR-0037: the jinni emits tokens, the app localizes them). Today's one cause
is the stock MQTT broker the U1 boots Klipper against.
"""
from collections.abc import Callable

from jinni.inspection import MQTT_PORT
from jinni.klipper_vocab import KLIPPER_SERVICE
from protocol import DeviceHealth

# The U1 boots Klipper against a stock MQTT broker on 1883; if that broker is down Klipper never
# comes back, and it is firmware, not a plugin. This token is that device fact's machine code.
BROKER_DOWN = "broker-down"


def diagnose_broker(report: DeviceHealth, port_listening: Callable[[int], bool]) -> DeviceHealth:
    """Klipper down AND the stock broker's port silent = the broker outage, not a plugin."""
    klipper = report.services.get(KLIPPER_SERVICE)
    if klipper is not None and not klipper.ready and not port_listening(MQTT_PORT):
        report.diagnosis = BROKER_DOWN
    return report
