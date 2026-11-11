#!/usr/bin/env python3
"""Compile the unchanged production scheduler body without Expo or an app build."""
from pathlib import Path
import subprocess
import tempfile

tests = Path(__file__).resolve().parent
source = (tests.parent / 'ios/PaliSlhLeafOperation.swift').read_text()
start = source.index('enum PaliSlhWorkKind:')
end = source.index('  func execute(', start)
with tempfile.TemporaryDirectory(prefix='pali-slh-swift-scheduler-') as scratch:
    scratch = Path(scratch)
    scheduler = scratch / 'Scheduler.swift'
    scheduler.write_text('import Foundation\n' + source[start:end] + '}\n')
    binary = scratch / 'scheduler'
    subprocess.run(['swiftc', '-swift-version', '6', '-strict-concurrency=complete',
                    '-module-cache-path', str(scratch / 'modules'), '-parse-as-library', str(scheduler), str(tests / 'SlhSchedulerChecks.swift'),
                    '-o', str(binary)], check=True, timeout=45)
    subprocess.run([str(binary)], check=True, timeout=30)
