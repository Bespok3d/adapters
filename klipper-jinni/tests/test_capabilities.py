"""The jinni runtime's reported facts, in isolation.

These test the jinni tiers directly (a generic box vs a klipper printer): what each declares as
capability flags, hardware, version, and so on. The daemon's assembly of these into a
`CapabilitiesResponse` over the seam is the daemon's concern, covered there (tests/api).
"""
import pytest

from jinni import KlipperPrinterJinni
from jinni.loader import GenericJinni


def test_generic_jinni_refuses_managed_services() -> None:
    jinni = GenericJinni()
    assert "managed-service" not in jinni.capability_flags()
    with pytest.raises(NotImplementedError):
        jinni.render_service_script({"name": "x", "command": "/bin/true"}, {"BESPOK3D": "/d"})


def test_generic_jinni_hardware_returns_empty_list() -> None:
    assert GenericJinni().hardware() == []


def test_generic_jinni_preferred_registries_returns_empty_list() -> None:
    assert GenericJinni().preferred_registries() == []


def test_generic_jinni_makes_no_klipper_version_claim() -> None:
    assert not hasattr(GenericJinni(), "klipper_version")


def test_klipper_jinni_reports_a_version_string() -> None:
    version = KlipperPrinterJinni().klipper_version()
    assert isinstance(version, str)
    assert len(version) > 0


def test_generic_jinni_installed_plugins_returns_a_dict() -> None:
    assert isinstance(GenericJinni().installed_plugins(), dict)


def test_generic_jinni_firmware_version_returns_unknown() -> None:
    assert GenericJinni().firmware_version() == "unknown"


def test_generic_jinni_arch_and_board_class_default_to_unknown() -> None:
    generic = GenericJinni()
    assert generic.arch() == "unknown"
    assert generic.board_class() == "unknown"
    assert generic.kernel_release() == "unknown"
    assert generic.kernel_vermagic() == "unknown"


def test_variant_facts_carry_the_selection_dimensions() -> None:
    facts = GenericJinni().variant_facts()
    assert set(facts) == {
        "adapter", "firmware_version", "arch", "board_class", "kernel_release", "vermagic"
    }
    assert facts["firmware_version"] == "unknown"
    assert facts["arch"] == "unknown"
    assert facts["board_class"] == "unknown"
    assert facts["kernel_release"] == "unknown"
    assert facts["vermagic"] == "unknown"


def test_capabilities_report_a_kernel_fact_defaulting_to_unknown() -> None:
    kernel = GenericJinni().capabilities()["kernel"]
    assert kernel == {"release": "unknown", "vermagic": "unknown"}


def test_classify_module_load_reports_no_cause_without_a_ring_buffer_line(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from jinni import kernel_log
    monkeypatch.setattr(kernel_log, "ring_buffer", lambda: "[  0.0] tun: loaded\n")
    assert GenericJinni().classify_module_load("tun") == ""


def test_classify_module_load_flags_a_version_magic_rejection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from jinni import kernel_log
    rejection = "[ 12.3] foo_bar: version magic '6.1.100 SMP' should be '6.1.99 SMP'\n"
    monkeypatch.setattr(kernel_log, "ring_buffer", lambda: rejection)
    # the plugin declares the hyphenated name; the kernel logs the underscore form, and the match
    # holds across that normalization (the OTA-kernel-bump case the autofixer keys on)
    assert GenericJinni().classify_module_load("foo-bar") == "kernel-module:vermagic-mismatch"


def test_classify_module_load_does_not_match_a_different_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from jinni import kernel_log
    monkeypatch.setattr(
        kernel_log, "ring_buffer",
        lambda: "[ 1.0] notun: version magic 'x' should be 'y'\n",
    )
    assert GenericJinni().classify_module_load("tun") == ""
