"""Derive server math/bank from unchanged single-player source; --check detects drift."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
html = (ROOT/'index.html').read_text()
math = html[html.index('    const MAX = '):html.index('    // คลังโจทย์ผ่าน Solver')]
math = math.replace('    let current = null;\n', '').replace('raw, nums = current.nums, mode = modeSelect.value', 'raw, nums, mode')
math = '\n'.join(line[4:] if line.startswith('    ') else line for line in math.splitlines())
bank = json.loads(re.search(r'    const puzzleBank = (\{[^\n]+\});', html).group(1))
beginners = json.loads(re.search(r'    const beginnerPuzzles = (\[[^\n]+\]);', html).group(1))
pool = html[html.index('    function playablePool('):html.index('    const recentPuzzles')]
hints = html[html.index('    function operationHint('):html.index('    function showHint(')]
module = ('// Generated from index.html by scripts/multiplayer/sync_rules.py. Do not edit.\n'
          + math + '\n' + 'const puzzleBank = ' + json.dumps(bank, ensure_ascii=False, separators=(',', ':')) + ';\n'
          + 'const beginnerPuzzles = ' + json.dumps(beginners, separators=(',', ':')) + ';\n'
          + pool + hints + '\nexport { calculateAnswer, is24, playablePool, operationHint, firstStepHint };\n')
parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
path = ROOT/'server/math-rules.mjs'
if args.check:
    if not path.exists() or path.read_text() != module:
        raise SystemExit('Server math rules differ from single-player source; regenerate and test parity')
    print('Server rules match unchanged single-player source')
else:
    path.write_text(module)
