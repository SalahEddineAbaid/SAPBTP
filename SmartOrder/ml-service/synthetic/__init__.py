"""
SmartOrder ML — synthetic package.

Exposes the public API for Phase 3 synthetic data generation.

Note: Generators are imported lazily to avoid circular import warnings
when running modules directly (e.g., python -m synthetic.pipeline).
"""

from __future__ import annotations

__all__ = [
    "RuleBasedAugmentor",
    "SyntheticValidator",
    "SyntheticValidationResult",
    "SyntheticPipeline",
    "GaussianPerturbationGenerator",
]


def __getattr__(name: str) -> object:
    """Lazy-load heavy submodule members to avoid circular import issues."""
    if name == "RuleBasedAugmentor":
        from synthetic.rule_based_augmentation import RuleBasedAugmentor
        return RuleBasedAugmentor
    if name == "SyntheticValidator":
        from synthetic.validator import SyntheticValidator
        return SyntheticValidator
    if name == "SyntheticValidationResult":
        from synthetic.validator import SyntheticValidationResult
        return SyntheticValidationResult
    if name == "SyntheticPipeline":
        from synthetic.pipeline import SyntheticPipeline
        return SyntheticPipeline
    if name == "GaussianPerturbationGenerator":
        from synthetic.perturbation_generator import GaussianPerturbationGenerator
        return GaussianPerturbationGenerator
    raise AttributeError(f"module 'synthetic' has no attribute {name!r}")
