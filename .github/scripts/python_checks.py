"""Run Python and notebook CI checks against tracked project files."""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

import nbformat


def run(command):
    """Run an internally constructed argument list and preserve failures."""
    # Commands are constructed internally without a shell or user command input.
    subprocess.run(command, check=True)  # nosec B603


def main():
    """Dispatch one CI check; explicitly report checks without input files."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "check", choices=["pylint", "ruff", "bandit", "notebooks", "tests"]
    )
    check = parser.parse_args().check
    git = shutil.which("git")
    if git is None:
        raise RuntimeError("Git is required to discover tracked files")
    # Fixed read-only Git operation using the resolved executable.
    result = subprocess.run(  # nosec B603
        [git, "ls-files", "-z"], check=True, capture_output=True
    )
    files = [Path(name) for name in result.stdout.decode().split("\0") if name]
    python_files = [str(path) for path in files if path.suffix == ".py"]
    notebooks = [str(path) for path in files if path.suffix == ".ipynb"]
    module = [sys.executable, "-m"]

    if check == "notebooks":
        if not notebooks:
            print("SKIPPED: no tracked notebooks; notebook checks did not run.")
            return
        for filename in notebooks:
            notebook = nbformat.read(filename, as_version=4)
            nbformat.validate(notebook)
            if any(
                cell.get("outputs") or cell.get("execution_count") is not None
                for cell in notebook.cells
                if cell.cell_type == "code"
            ):
                raise ValueError(f"{filename}: clear outputs before committing")
        run(module + ["nbqa", "ruff", *notebooks])
        return

    if check == "tests":
        tests = [
            str(path)
            for path in files
            if path.suffix == ".py"
            and (path.name.startswith("test_") or path.name.endswith("_test.py"))
        ]
        if not tests:
            print("SKIPPED: no tracked pytest tests; application tests did not run.")
            return
        run(module + ["pytest", "-q", *tests])
        return

    if not python_files:
        print(f"SKIPPED: no tracked Python files for {check}.")
        return
    if check == "pylint":
        run(module + ["pylint", "--fail-under=8.0", "--fail-on=E,F", *python_files])
    elif check == "ruff":
        run(module + ["ruff", "check", *python_files])
        run(module + ["ruff", "format", "--check", *python_files])
    elif check == "bandit":
        run(module + ["bandit", "-ll", "-ii", *python_files])


if __name__ == "__main__":
    main()
