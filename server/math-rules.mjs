// Generated from index.html by scripts/multiplayer/sync_rules.py. Do not edit.
const MAX = 1000000000n; // จำกัดค่าระหว่างทาง ป้องกันตัวเลขมหาศาล

// ใช้เศษส่วนแบบ BigInt เพื่อไม่ต้องปัดเศษในการตัดสินคำตอบ
function abs(n) { return n < 0n ? -n : n; }
function gcd(a, b) {
  a = abs(a); b = abs(b);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}
function fraction(n, d = 1n) {
  if (d === 0n) throw Error('ห้ามหารด้วยศูนย์');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  if (g !== 0n) { n /= g; d /= g; }
  if (abs(n) > MAX || d > MAX) throw Error('ตัวเลขระหว่างคำนวณใหญ่เกินไป');
  return { n, d };
}
const add = (a,b) => fraction(a.n*b.d+b.n*a.d, a.d*b.d);
const subtract = (a,b) => fraction(a.n*b.d-b.n*a.d, a.d*b.d);
const multiply = (a,b) => fraction(a.n*b.n, a.d*b.d);
const divide = (a,b) => fraction(a.n*b.d, a.d*b.n);
const is24 = x => x.n === 24n*x.d;

function factorial(a) {
  if (a.d !== 1n || a.n < 0n || a.n > 6n)
    throw Error('แฟกทอเรียล (!) ใช้ได้กับจำนวนเต็ม 0 ถึง 6');
  let result = 1n;
  for (let i = 2n; i <= a.n; i++) result *= i;
  return fraction(result);
}
function squareRoot(a) {
  if (a.n < 0n) throw Error('√ ใช้กับจำนวนติดลบไม่ได้ในเกมนี้');
  const rN = BigInt(Math.floor(Math.sqrt(Number(a.n))));
  const rD = BigInt(Math.floor(Math.sqrt(Number(a.d))));
  if (rN*rN !== a.n || rD*rD !== a.d)
    throw Error('√ ต้องได้ผลลัพธ์เป็นจำนวนตรรกยะที่คำนวณได้ตรงตัว');
  return fraction(rN, rD);
}
function power(a, b) {
  if (b.d !== 1n || b.n < -4n || b.n > 4n)
    throw Error('เลขชี้กำลังต้องเป็นจำนวนเต็มตั้งแต่ −4 ถึง 4');
  if (a.n === 0n && b.n <= 0n) throw Error('ไม่อนุญาตให้ยกกำลังศูนย์หรือติดลบจากฐาน 0');
  const exp = abs(b.n);
  return b.n >= 0n
    ? fraction(a.n**exp, a.d**exp)
    : fraction(a.d**exp, a.n**exp);
}
function sameNumbers(a, b) {
  return [...a].sort((x,y)=>x-y).join(',') ===
         [...b].sort((x,y)=>x-y).join(',');
}

// แปลงสูตรของผู้เล่นเป็นคำตอบอย่างปลอดภัย ไม่ใช้ eval()
function calculateAnswer(raw, nums, mode) {
  const source = raw.replace(/\s/g, '').replaceAll('×','*')
    .replaceAll('÷','/').replaceAll('−','-');
  // จำนวนลบจากโจทย์ต้องเขียน (-3) เท่านั้น; '-' เดี่ยวคือเครื่องหมายลบ
  const tokens = source.match(/\(-[1-9]\)|\d+|[()+*/^!√-]/g);
  if (!tokens || tokens.join('') !== source)
    throw Error('มีสัญลักษณ์ที่ไม่รองรับ');
  if (mode === 'basic' && /[√!^]/.test(source))
    throw Error('เครื่องหมาย √ ! ^ ใช้ได้ในโหมดขั้นสูงเท่านั้น');
  if (['√','!','^'].some(op => tokens.filter(t => t === op).length > 1))
    throw Error('ใช้ √ ! และ ^ ได้อย่างละไม่เกินหนึ่งครั้งต่อสูตร');
  const numberTokens = tokens.filter(t => /^\d+$/.test(t) || /^\(-[1-9]\)$/.test(t));
  if (numberTokens.some(t => /^\d+$/.test(t) && t.length !== 1))
    throw Error('ห้ามนำตัวเลขมาต่อกัน ต้องใช้ทีละหนึ่งหลัก');
  const used = numberTokens.map(t => t[0] === '(' ? -Number(t[2]) : Number(t));
  if (used.length !== 4 || !sameNumbers(used, nums))
    throw Error('ต้องใช้เลขบนการ์ดให้ครบทั้ง 4 ตัว ตัวละหนึ่งครั้ง');
  let pos = 0;
  function primary() {
    const t = tokens[pos++];
    if (t === '(') {
      const value = expression();
      if (tokens[pos++] !== ')') throw Error('วงเล็บไม่ถูกต้อง');
      return value;
    }
    if (t && /^\(-[1-9]\)$/.test(t)) return fraction(-BigInt(t[2]));
    if (t && /^\d$/.test(t)) return fraction(BigInt(t));
    throw Error('รูปแบบสูตรไม่ถูกต้อง');
  }
  function postfix() {
    let value = primary();
    while (tokens[pos] === '!') { pos++; value = factorial(value); }
    return value;
  }
  function exponent() {
    let value = postfix();
    if (tokens[pos] === '^') {
      pos++;
      value = power(value, unary()); // ยกกำลังชิดขวา
    }
    return value;
  }
  function unary() {
    if (tokens[pos] === '√') { pos++; return squareRoot(unary()); }
    return exponent();
  }
  function term() {
    let value = unary();
    while (tokens[pos] === '*' || tokens[pos] === '/') {
      const op = tokens[pos++];
      const right = unary();
      value = op === '*' ? multiply(value, right) : divide(value, right);
    }
    return value;
  }
  function expression() {
    let value = term();
    while (tokens[pos] === '+' || tokens[pos] === '-') {
      const op = tokens[pos++];
      const right = term();
      value = op === '+' ? add(value, right) : subtract(value, right);
    }
    return value;
  }
  const result = expression();
  if (pos !== tokens.length) throw Error('รูปแบบสูตรไม่ถูกต้อง');
  return result;
}

// Solver พื้นฐาน: เลือก 2 ก้อนมารวม แล้วค้นหาต่อจนได้ 24
// รับก้อนที่ผ่าน √, ! หรือ ^ มาแล้วได้ จึงใช้สร้างโจทย์ขั้นสูงได้ด้วย
function findSolutionFromNodes(start) {
  const failed = new Set();
  function solve(items) {
    if (items.length === 1) return is24(items[0].value) ? items[0].text : null;
    const signature = items.map(x => `${x.value.n}/${x.value.d}`).sort().join('|');
    if (failed.has(signature)) return null;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const rest = items.filter((_, k) => k !== i && k !== j);
        const choices = [
          [add, a, b, '+'], [subtract, a, b, '-'], [subtract, b, a, '-'],
          [multiply, a, b, '*'], [divide, a, b, '/'], [divide, b, a, '/']
        ];
        for (const [op, left, right, symbol] of choices) {
          let value;
          try { value = op(left.value, right.value); }
          catch { continue; }
          const node = {value, text:`(${left.text}${symbol}${right.text})`};
          const solution = solve([...rest, node]);
          if (solution !== null) return solution;
        }
      }
    }
    failed.add(signature);
    return null;
  }
  return solve(start);
}
function numberNodes(nums) {
  return nums.map(n => ({ value:fraction(BigInt(n)), text:n < 0 ? `(${n})` : String(n) }));
}
function findBasicSolution(nums) {
  return findSolutionFromNodes(numberNodes(nums));
}

// สร้างสูตรขั้นสูงจาก 1 เครื่องหมายพิเศษ + Solver พื้นฐาน
// คืนเฉพาะสูตรที่ตรวจซ้ำแล้วว่าได้ 24 และใช้เลขครบทุกตัว
function findAdvancedSolution(nums, special) {
  const nodes = numberNodes(nums);
  if (special === '!') {
    for (let i = 0; i < 4; i++) {
      if (nums[i] < 3 || nums[i] > 6) continue;
      const changed = nodes.map((node, k) => k === i
        ? {value:factorial(node.value), text:`(${node.text}!)`} : node);
      const solution = findSolutionFromNodes(changed);
      if (solution !== null) return solution;
    }
  }
  if (special === '√') {
    for (let i = 0; i < 4; i++) {
      if (nums[i] !== 4 && nums[i] !== 9) continue;
      const changed = nodes.map((node, k) => k === i
        ? {value:squareRoot(node.value), text:`√(${node.text})`} : node);
      const solution = findSolutionFromNodes(changed);
      if (solution !== null) return solution;
    }
  }
  if (special === '^') {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      if (i === j || Math.abs(nums[i]) < 2 || nums[j] < 2 || nums[j] > 4) continue;
      let value;
      try { value = power(nodes[i].value, nodes[j].value); }
      catch { continue; }
      const rest = nodes.filter((_, k) => k !== i && k !== j);
      const solution = findSolutionFromNodes([
        ...rest, {value, text:`(${nodes[i].text}^${nodes[j].text})`}
      ]);
      if (solution !== null) return solution;
    }
  }
  return null;
}

const puzzleBank = {"basic":{"easy":[{"nums":[4,4,-8,9],"solution":"((4*9)-(4-(-8)))","special":"basic"},{"nums":[-4,3,9,5],"solution":"(3*((9-(-4))-5))","special":"basic"},{"nums":[5,4,4,-7],"solution":"(4*((4-5)-(-7)))","special":"basic"},{"nums":[6,0,1,4],"solution":"((6+0)*(1*4))","special":"basic"},{"nums":[8,6,7,4],"solution":"((8-7)*(6*4))","special":"basic"},{"nums":[3,-3,-6,8],"solution":"(8*((-6)-(3*(-3))))","special":"basic"},{"nums":[4,6,3,4],"solution":"((6-4)*(3*4))","special":"basic"},{"nums":[-2,3,6,0],"solution":"(((-2)-6)*(0-3))","special":"basic"},{"nums":[4,-6,-4,1],"solution":"(4+((-4)*((-6)+1)))","special":"basic"},{"nums":[7,8,-8,2],"solution":"((-8)*((7-8)-2))","special":"basic"},{"nums":[-4,-5,6,4],"solution":"(((-4)-(-5))*(6*4))","special":"basic"},{"nums":[5,8,1,-9],"solution":"((5-8)*(1+(-9)))","special":"basic"},{"nums":[8,-4,1,0],"solution":"((0-8)*((-4)+1))","special":"basic"},{"nums":[3,0,-6,-2],"solution":"((0-3)*((-6)+(-2)))","special":"basic"},{"nums":[9,-4,5,7],"solution":"((-4)+(7*(9-5)))","special":"basic"},{"nums":[2,6,2,3],"solution":"((6-2)*(2*3))","special":"basic"},{"nums":[-1,3,1,6],"solution":"((3-(-1))*(1*6))","special":"basic"},{"nums":[5,4,6,2],"solution":"(6+(2*(5+4)))","special":"basic"},{"nums":[-9,3,-1,5],"solution":"(((-9)*(-1))+(3*5))","special":"basic"},{"nums":[9,4,2,9],"solution":"((9+4)+(2+9))","special":"basic"},{"nums":[9,6,5,4],"solution":"((9+6)+(5+4))","special":"basic"},{"nums":[5,4,6,3],"solution":"(6*(3+(5-4)))","special":"basic"},{"nums":[2,3,1,7],"solution":"((2+1)+(3*7))","special":"basic"},{"nums":[7,6,4,5],"solution":"(4*(5+(7-6)))","special":"basic"},{"nums":[9,4,6,6],"solution":"((6*(9-4))-6)","special":"basic"},{"nums":[4,5,6,6],"solution":"((4*6)*(6-5))","special":"basic"},{"nums":[8,6,2,3],"solution":"((3*(8+2))-6)","special":"basic"},{"nums":[5,0,4,6],"solution":"((5*0)+(4*6))","special":"basic"}],"medium":[{"nums":[3,9,1,9],"solution":"((9/3)*(9-1))","special":"basic"},{"nums":[4,-8,-5,8],"solution":"(8*(((-8)/4)-(-5)))","special":"basic"},{"nums":[5,5,9,3],"solution":"(3*(9-(5/5)))","special":"basic"},{"nums":[-5,8,5,2],"solution":"(8*(2-((-5)/5)))","special":"basic"},{"nums":[5,5,8,8],"solution":"((5*5)-(8/8))","special":"basic"},{"nums":[3,3,5,5],"solution":"((5*5)-(3/3))","special":"basic"},{"nums":[-7,2,3,6],"solution":"((6/2)-((-7)*3))","special":"basic"},{"nums":[5,2,-5,-8],"solution":"((-8)*((5/(-5))-2))","special":"basic"},{"nums":[4,5,-8,8],"solution":"(8*(5+((-8)/4)))","special":"basic"},{"nums":[8,-9,6,4],"solution":"(6-((8*(-9))/4))","special":"basic"},{"nums":[8,9,9,4],"solution":"(8*(4-(9/9)))","special":"basic"},{"nums":[-5,-5,4,4],"solution":"(((-5)*(-5))-(4/4))","special":"basic"},{"nums":[1,9,3,8],"solution":"(8*((1*9)/3))","special":"basic"},{"nums":[4,7,5,5],"solution":"(4*(7-(5/5)))","special":"basic"},{"nums":[9,-2,-6,5],"solution":"(9+(5*((-6)/(-2))))","special":"basic"},{"nums":[5,9,4,-9],"solution":"(4*(5-(9/(-9))))","special":"basic"},{"nums":[2,0,6,8],"solution":"((6*8)/(2+0))","special":"basic"},{"nums":[4,7,6,9],"solution":"(6*((7+9)/4))","special":"basic"},{"nums":[8,9,-6,9],"solution":"((8*9)/((-6)+9))","special":"basic"},{"nums":[7,1,3,9],"solution":"((7+1)*(9/3))","special":"basic"},{"nums":[5,6,2,9],"solution":"(9+((5*6)/2))","special":"basic"},{"nums":[5,5,-5,5],"solution":"((5*5)+((-5)/5))","special":"basic"},{"nums":[5,5,8,2],"solution":"(8*(2+(5/5)))","special":"basic"},{"nums":[5,6,7,7],"solution":"(6*(5-(7/7)))","special":"basic"},{"nums":[6,6,-6,5],"solution":"((-6)*((6/6)-5))","special":"basic"},{"nums":[6,6,6,5],"solution":"(6*(5-(6/6)))","special":"basic"},{"nums":[8,4,-5,8],"solution":"(4*((8/8)-(-5)))","special":"basic"},{"nums":[0,6,-2,8],"solution":"((0-6)*(8/(-2)))","special":"basic"}],"hard":[{"nums":[1,5,-4,-6],"solution":"((-6)/(1+(5/(-4))))","special":"basic"},{"nums":[8,1,6,6],"solution":"(6/(1-(6/8)))","special":"basic"},{"nums":[8,-3,3,8],"solution":"(8/(3+(8/(-3))))","special":"basic"},{"nums":[-7,1,3,8],"solution":"(3/(1+((-7)/8)))","special":"basic"},{"nums":[4,1,6,3],"solution":"(6/(1-(3/4)))","special":"basic"},{"nums":[1,6,-4,3],"solution":"(6/(1+(3/(-4))))","special":"basic"},{"nums":[4,1,5,-6],"solution":"((-6)/(1-(5/4)))","special":"basic"},{"nums":[1,4,6,5],"solution":"(6/((5/4)-1))","special":"basic"},{"nums":[-6,8,6,-1],"solution":"(6/(((-6)/8)-(-1)))","special":"basic"},{"nums":[5,1,6,-4],"solution":"((-4)/((5/6)-1))","special":"basic"},{"nums":[4,4,7,7],"solution":"(7*(4-(4/7)))","special":"basic"},{"nums":[4,1,6,-5],"solution":"(4/(1+((-5)/6)))","special":"basic"},{"nums":[-1,6,5,-4],"solution":"((-4)/((-1)+(5/6)))","special":"basic"},{"nums":[1,5,-5,5],"solution":"((-5)*((1/5)-5))","special":"basic"},{"nums":[3,-8,3,8],"solution":"(8/(3+((-8)/3)))","special":"basic"},{"nums":[3,3,7,7],"solution":"(7*(3+(3/7)))","special":"basic"},{"nums":[4,7,4,-7],"solution":"((-7)*((4/7)-4))","special":"basic"},{"nums":[3,1,-6,4],"solution":"((-6)/((3/4)-1))","special":"basic"},{"nums":[3,7,-3,-7],"solution":"((-7)*((-3)-(3/7)))","special":"basic"},{"nums":[3,3,8,8],"solution":"(8/(3-(8/3)))","special":"basic"},{"nums":[5,1,5,5],"solution":"(5*(5-(1/5)))","special":"basic"}]},"advanced":{"easy":[{"nums":[4,4,-8,9],"solution":"(((4!)*4)+((-8)*9))","special":"!"},{"nums":[-4,3,9,5],"solution":"((9+5)-((-4)-(3!)))","special":"!"},{"nums":[5,4,4,-7],"solution":"((4*(5-(-7)))-(4!))","special":"!"},{"nums":[5,0,2,4],"solution":"((4!)+(2*(5*0)))","special":"!"},{"nums":[6,0,1,4],"solution":"((6*0)+(1*(4!)))","special":"!"},{"nums":[8,4,3,8],"solution":"(3*(((4!)-8)-8))","special":"!"},{"nums":[8,6,7,4],"solution":"((√(4)*(8+7))-6)","special":"√"},{"nums":[3,-3,-6,8],"solution":"(8*((-6)+((3!)-(-3))))","special":"!"},{"nums":[4,4,0,1],"solution":"(((4!)*1)+(4*0))","special":"!"},{"nums":[4,6,3,4],"solution":"((4!)*(4-(6-3)))","special":"!"},{"nums":[-2,3,6,0],"solution":"(((-2)+(3!))*(6+0))","special":"!"},{"nums":[4,-6,-4,1],"solution":"((4!)*(((-4)-(-6))-1))","special":"!"},{"nums":[1,3,5,-5],"solution":"(((3!)*5)-(1-(-5)))","special":"!"},{"nums":[-4,-5,6,4],"solution":"(6*((4!)-((-4)*(-5))))","special":"!"},{"nums":[3,0,-6,-2],"solution":"(((3!)+0)*((-2)-(-6)))","special":"!"},{"nums":[9,-4,5,7],"solution":"((5+7)-(√(9)*(-4)))","special":"√"},{"nums":[2,6,2,3],"solution":"((2*6)+(2*(3!)))","special":"!"},{"nums":[-1,3,1,6],"solution":"(6*(((-1)+(3!))-1))","special":"!"},{"nums":[5,4,6,2],"solution":"((4!)*(2+(5-6)))","special":"!"},{"nums":[5,3,5,1],"solution":"((5*(3!))-(5+1))","special":"!"},{"nums":[-9,3,-1,5],"solution":"((3!)*(((-9)*(-1))-5))","special":"!"},{"nums":[9,4,2,9],"solution":"((4!)+(2*(9-9)))","special":"!"},{"nums":[-2,3,4,-8],"solution":"((4*((-2)+(3!)))-(-8))","special":"!"},{"nums":[9,6,5,4],"solution":"(6*((√(9)+5)-4))","special":"√"},{"nums":[4,0,9,5],"solution":"((4!)+(5*(0*9)))","special":"!"},{"nums":[9,8,9,0],"solution":"((√(9)*8)+(9*0))","special":"√"},{"nums":[3,-7,3,1],"solution":"(((3!)-3)*(1-(-7)))","special":"!"},{"nums":[5,4,6,3],"solution":"((6*(5+3))-(4!))","special":"!"}],"medium":[{"nums":[5,8,1,-9],"solution":"(((5!)/8)-(1*(-9)))","special":"!"},{"nums":[2,-5,8,6],"solution":"(((6!)/(-5))/(2-8))","special":"!"},{"nums":[6,-9,-3,5],"solution":"(((6!)/5)/((-3)-(-9)))","special":"!"},{"nums":[0,8,2,3],"solution":"((0+8)*((3!)/2))","special":"!"},{"nums":[5,8,-4,6],"solution":"(((5!)/6)+(8+(-4)))","special":"!"},{"nums":[5,5,-6,7],"solution":"(((5!)/5)*((-6)+7))","special":"!"},{"nums":[1,6,-5,5],"solution":"(((6!)/5)/(1-(-5)))","special":"!"},{"nums":[3,6,1,8],"solution":"((6^3)/(1+8))","special":"^"},{"nums":[2,5,6,1],"solution":"((5!)/(1-(2-6)))","special":"!"},{"nums":[6,1,6,5],"solution":"(((6!)*1)/(6*5))","special":"!"},{"nums":[-9,3,2,5],"solution":"((5*((3!)/2))-(-9))","special":"!"},{"nums":[1,9,9,-7],"solution":"((1-(-7))*(9/√(9)))","special":"√"},{"nums":[5,8,5,6],"solution":"((8*6)-((5!)/5))","special":"!"},{"nums":[6,9,7,-2],"solution":"(√(9)-((6*7)/(-2)))","special":"√"},{"nums":[5,-1,7,1],"solution":"((5!)/(((-1)+7)-1))","special":"!"},{"nums":[3,-9,4,8],"solution":"((3!)-(((-9)*8)/4))","special":"!"},{"nums":[5,2,-3,1],"solution":"(((5!)*1)/(2-(-3)))","special":"!"},{"nums":[7,-2,0,5],"solution":"((0+(5!))/(7+(-2)))","special":"!"},{"nums":[7,5,2,1],"solution":"(((5!)*1)/(7-2))","special":"!"},{"nums":[9,-3,6,8],"solution":"((8-((6!)/9))/(-3))","special":"!"},{"nums":[9,7,5,7],"solution":"((5!)/(7-(9-7)))","special":"!"},{"nums":[5,5,9,1],"solution":"((5!)/(1-(5-9)))","special":"!"},{"nums":[7,7,5,5],"solution":"((7-7)+((5!)/5))","special":"!"},{"nums":[6,7,6,2],"solution":"(((6!)/6)/(7-2))","special":"!"},{"nums":[6,5,6,0],"solution":"(((6!)/5)/(6+0))","special":"!"},{"nums":[7,6,8,2],"solution":"(((6!)/2)/(7+8))","special":"!"},{"nums":[5,6,7,5],"solution":"(((5!)/5)*(7-6))","special":"!"},{"nums":[6,5,5,1],"solution":"(((6!)/5)/(5+1))","special":"!"}],"hard":[{"nums":[-6,0,5,5],"solution":"(((-6)*0)+((5!)/5))","special":"!"},{"nums":[5,5,0,2],"solution":"(((5!)/5)+(0*2))","special":"!"},{"nums":[7,7,5,1],"solution":"(7+(((5!)-1)/7))","special":"!"},{"nums":[1,5,-4,-6],"solution":"((-6)-((1*(5!))/(-4)))","special":"!"},{"nums":[0,2,3,5],"solution":"((5!)/(3+(0+2)))","special":"!"},{"nums":[5,5,9,3],"solution":"(9+((5!)/(5+3)))","special":"!"},{"nums":[9,3,6,0],"solution":"((6^3)/(9+0))","special":"^"},{"nums":[5,5,0,9],"solution":"(((5!)/5)+(0*9))","special":"!"},{"nums":[0,5,5,0],"solution":"((0+(5!))/(5+0))","special":"!"},{"nums":[-5,8,5,2],"solution":"((5!)/(2+((-5)+8)))","special":"!"},{"nums":[5,5,8,8],"solution":"(((5!)/5)+(8-8))","special":"!"},{"nums":[7,-2,5,8],"solution":"((7-(-2))+((5!)/8))","special":"!"},{"nums":[-7,2,3,6],"solution":"((6-((-7)*(3!)))/2)","special":"!"},{"nums":[5,2,-5,-8],"solution":"((5!)/((2+(-5))-(-8)))","special":"!"},{"nums":[9,7,9,-7],"solution":"(√(9)*(9+(7/(-7))))","special":"√"},{"nums":[-2,3,5,0],"solution":"((0-(5!))/((-2)-3))","special":"!"},{"nums":[5,5,2,5],"solution":"(((5!)*2)/(5+5))","special":"!"},{"nums":[5,0,-5,8],"solution":"((0*8)-((5!)/(-5)))","special":"!"},{"nums":[5,1,6,-4],"solution":"((((5!)*1)/6)-(-4))","special":"!"},{"nums":[5,-1,7,7],"solution":"(7+(((5!)+(-1))/7))","special":"!"},{"nums":[0,5,7,5],"solution":"((0*7)+((5!)/5))","special":"!"},{"nums":[5,5,-5,5],"solution":"(((-5)+((5!)+5))/5)","special":"!"},{"nums":[5,5,8,2],"solution":"((5!)/(2-(5-8)))","special":"!"},{"nums":[5,6,7,7],"solution":"((5!)/(6-(7/7)))","special":"!"},{"nums":[0,5,9,-5],"solution":"((0*9)-((5!)/(-5)))","special":"!"},{"nums":[5,5,1,-9],"solution":"((5!)/((1-5)-(-9)))","special":"!"},{"nums":[9,7,7,9],"solution":"(√(9)*(9-(7/7)))","special":"√"},{"nums":[1,8,9,9],"solution":"((1*8)*(9/√(9)))","special":"√"}]}};
const beginnerPuzzles = [{"nums":[1,2,3,4],"solution":"1*2*3*4","special":"basic"},{"nums":[1,1,4,6],"solution":"1*1*4*6","special":"basic"},{"nums":[1,1,3,8],"solution":"1*1*3*8","special":"basic"},{"nums":[4,4,4,4],"solution":"4*4+4+4","special":"basic"},{"nums":[6,6,6,6],"solution":"6+6+6+6","special":"basic"},{"nums":[9,9,3,3],"solution":"9+9+3+3","special":"basic"},{"nums":[8,8,4,4],"solution":"8+8+4+4","special":"basic"},{"nums":[9,8,4,3],"solution":"9+8+4+3","special":"basic"},{"nums":[7,7,5,5],"solution":"7+7+5+5","special":"basic"},{"nums":[9,9,4,2],"solution":"9+9+4+2","special":"basic"},{"nums":[8,7,5,4],"solution":"8+7+5+4","special":"basic"},{"nums":[8,6,6,4],"solution":"8+6+6+4","special":"basic"},{"nums":[9,6,5,4],"solution":"9+6+5+4","special":"basic"},{"nums":[7,6,6,5],"solution":"7+6+6+5","special":"basic"},{"nums":[1,1,4,5],"solution":"4*(5+1)*1","special":"basic"},{"nums":[1,2,2,6],"solution":"6*(2+2)*1","special":"basic"},{"nums":[1,3,3,5],"solution":"3*(3+5)*1","special":"basic"},{"nums":[1,2,3,9],"solution":"2*(3+9)*1","special":"basic"},{"nums":[0,1,4,6],"solution":"6*4+0*1","special":"basic"},{"nums":[1,1,5,5],"solution":"5*5-1*1","special":"basic"},{"nums":[2,2,3,8],"solution":"3*8+2-2","special":"basic"},{"nums":[3,3,4,6],"solution":"4*6+3-3","special":"basic"},{"nums":[5,5,4,6],"solution":"4*6+5-5","special":"basic"},{"nums":[2,2,4,6],"solution":"4*6+2-2","special":"basic"},{"nums":[1,1,6,4],"solution":"6*4+1-1","special":"basic"}];
    function playablePool(mode, difficulty) {
      if (mode === 'basic' && difficulty === 'easy') return beginnerPuzzles;
      const full = puzzleBank[mode][difficulty];
      // ไม่สุ่มเลขติดลบในพื้นฐานง่าย/กลาง หรือขั้นสูงง่าย
      if (difficulty === 'easy' || (mode === 'basic' && difficulty === 'medium')) {
        return full.filter(p => p.nums.every(n => n >= 0));
      }
      return full;
    }
    function operationHint(solution) {
      const clean = solution.replace(/\(-[1-9]\)/g, '');
      if (clean.includes('!')) return 'ลองใช้แฟกทอเรียล (!) กับการ์ดจำนวนเต็มบวก';
      if (clean.includes('√')) return 'ลองพิจารณาใช้สแควรูท (√) กับจำนวนที่ถอดรากได้';
      if (clean.includes('^')) return 'ลองใช้เลขยกกำลังเพื่อสร้างค่าที่ต้องการ';
      if (clean.includes('/')) return 'ลองใช้การหาร (÷) ระหว่างทาง';
      if (clean.includes('*')) return 'ลองมองหาคู่ที่คูณกันแล้วได้ 24 หรือเป็นตัวประกอบของ 24';
      if (clean.includes('+')) return 'ลองจัดกลุ่มการบวก เพื่อให้ได้ 24';
      return 'ลองใช้วงเล็บจัดกลุ่มตัวเลขก่อน';
    }
    function firstStepHint(solution) {
      // เลือกการคำนวณย่อยที่อยู่ในสูตรเฉลยจริง ไม่แสดงสูตรเต็ม
      const negOrDigit = '(?:\\(-[1-9]\\)|[0-9])';
      const match = solution.match(new RegExp('\\(('+negOrDigit+')([+\\-*/])('+negOrDigit+')\\)'));
      if (match) {
        const a = Number(match[1].startsWith('(') ? match[1].slice(1,-1) : match[1]);
        const b = Number(match[3].startsWith('(') ? match[3].slice(1,-1) : match[3]);
        const sign = match[2];
        const left = fraction(BigInt(a)), right = fraction(BigInt(b));
        const result = sign === '+' ? add(left,right) : sign === '-' ? subtract(left,right)
          : sign === '*' ? multiply(left,right) : divide(left,right);
        const asText = result.d === 1n ? String(result.n) : `${result.n}/${result.d}`;
        const symbol = {'+':'+', '-':'−', '*':'×', '/':'÷'}[sign];
        return `ลองเริ่มจาก ${a} ${symbol} ${b} = ${asText} แล้วใช้ตัวเลขที่เหลือต่อ`;
      }
      const fact = solution.match(/([0-6])!/);
      if (fact) return `ลองเริ่มจาก ${fact[1]}! = ${Number(factorial(fraction(BigInt(fact[1]))).n)} แล้วใช้ตัวเลขที่เหลือต่อ`;
      const sqrt = solution.match(/√\(([0-9])\)/);
      if (sqrt) return `ลองเริ่มจาก √${sqrt[1]} แล้วใช้ตัวเลขที่เหลือต่อ`;
      const pow = solution.match(/([0-9])\^([0-9])/);
      if (pow) return `ลองเริ่มจาก ${pow[1]} ยกกำลัง ${pow[2]} แล้วใช้ตัวเลขที่เหลือต่อ`;
      return 'ลองจับคู่การ์ด 2 ใบแล้วคำนวณทีละส่วน จากนั้นนำผลไปเชื่อมกับเลขที่เหลือ';
    }

export { calculateAnswer, is24, playablePool, operationHint, firstStepHint };
