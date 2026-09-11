// Generates datasets/office-demo/{world,personas,tenants/*}.json. Run from platform/:
//   node datasets/office-demo/generate.mjs datasets/office-demo
// Floor-plan rule: room markers stay out of the header band (top 48 px) where code, name and live
// power are drawn; light and AC sit bottom-left, the room meter bottom-right, sensors in the middle.
import { writeFileSync } from 'node:fs';
const out = process.argv[2];

// Floor layout in a 1000x600 viewBox. Meeting rooms along the top, open plan bottom-left,
// service rooms bottom-right. Zones split each floor into West (x<500) and East.
const floors = [
  { number: 1, code: 'F1', name: 'Floor 1' },
  { number: 2, code: 'F2', name: 'Floor 2' },
];
const zones = [];
for (const f of floors) {
  zones.push({
    code: `${f.number}.West`,
    name: `Floor ${f.number} West`,
    floor: f.number,
    accessPoint: `AP-${f.number}W`,
  });
  zones.push({
    code: `${f.number}.East`,
    name: `Floor ${f.number} East`,
    floor: f.number,
    accessPoint: `AP-${f.number}E`,
  });
}

const meetingCaps = [4, 6, 8, 12];
const rooms = [];
const desks = [];
const devices = [];

function lightPower(kind) {
  return kind === 'meeting' ? 60 : kind === 'open_plan' ? 240 : 40;
}
function acSpec(kind, cap) {
  if (kind === 'open_plan') return { p: 1400, base: 5.9 };
  if (kind === 'server') return { p: 1400, base: 5.9 };
  if (kind === 'meeting')
    return {
      p: cap >= 12 ? 1200 : cap >= 8 ? 1000 : 800,
      base: cap >= 12 ? 5.1 : cap >= 8 ? 4.2 : 3.4,
    };
  return { p: 800, base: 3.4 };
}
function nightBaseline(kind) {
  return kind === 'server' ? 3000 : kind === 'pantry' ? 180 : kind === 'open_plan' ? 90 : 25;
}
function center(g) {
  return { x: g.x + g.w / 2, y: g.y + g.h / 2 };
}

for (const f of floors) {
  const n = f.number;
  // four meeting rooms across the top row
  const meetingWidths = [160, 200, 240, 300]; // proportional to capacity
  let x = 40;
  meetingCaps.forEach((cap, i) => {
    const code = `${n}.${i + 1}`;
    const w = meetingWidths[i];
    const geometry = { x, y: 40, w, h: 180 };
    x += w + 20;
    const zone = geometry.x + w / 2 < 500 ? `${n}.West` : `${n}.East`;
    rooms.push({
      code,
      name: `Meeting room ${code}`,
      floor: n,
      kind: 'meeting',
      zone,
      capacity: cap,
      critical: false,
      geometry,
    });
  });
  // open plan bottom-left, spans both zones
  const open = {
    code: `${n}.O`,
    name: `Open plan ${n}`,
    floor: n,
    kind: 'open_plan',
    zone: `${n}.West`,
    capacity: 12,
    critical: false,
    geometry: { x: 40, y: 260, w: 620, h: 300 },
  };
  rooms.push(open);
  // service rooms bottom-right
  if (n === 1) {
    rooms.push({
      code: '1.P',
      name: 'Pantry',
      floor: 1,
      kind: 'pantry',
      zone: '1.East',
      critical: false,
      geometry: { x: 700, y: 260, w: 260, h: 140 },
    });
    rooms.push({
      code: '1.R',
      name: 'Reception',
      floor: 1,
      kind: 'reception',
      zone: '1.East',
      critical: false,
      geometry: { x: 700, y: 420, w: 260, h: 140 },
    });
  } else {
    rooms.push({
      code: '2.S',
      name: 'Server room',
      floor: 2,
      kind: 'server',
      zone: '2.East',
      critical: true,
      geometry: { x: 700, y: 260, w: 260, h: 300 },
    });
  }
  // 12 desks in the open plan: 2 rows x 6, west half = first 3 columns
  for (let i = 0; i < 12; i++) {
    const col = i % 6,
      row = Math.floor(i / 6);
    const dx = open.geometry.x + 60 + col * 100;
    const dy = open.geometry.y + 80 + row * 140;
    const zone = col < 3 ? `${n}.West` : `${n}.East`;
    desks.push({
      code: `D-${n}.O-${String(i + 1).padStart(2, '0')}`,
      room: `${n}.O`,
      zone,
      x: dx,
      y: dy,
    });
  }
}

for (const r of rooms) {
  const c = center(r.geometry);
  const n = r.floor;
  devices.push({
    code: `LIGHT-${r.code}`,
    name: `Light ${r.code}`,
    type: 'light',
    room: r.code,
    nominalPowerW: lightPower(r.kind),
    x: r.geometry.x + 24,
    y: r.geometry.y + r.geometry.h - 24,
    attrs: {},
  });
  const ac = acSpec(r.kind, r.capacity ?? 0);
  devices.push({
    code: `AC-${r.code}`,
    name: `AC unit ${r.code}`,
    type: 'ac',
    room: r.code,
    nominalPowerW: ac.p,
    nominalCurrentA: ac.base,
    filterDegrading: r.code === '2.3',
    x: r.geometry.x + 54,
    y: r.geometry.y + r.geometry.h - 24,
    attrs: {},
  });
  devices.push({
    code: `RM-${r.code}`,
    name: `Room meter ${r.code}`,
    type: 'room_meter',
    room: r.code,
    nightBaselineW: nightBaseline(r.kind),
    x: r.geometry.x + r.geometry.w - 24,
    y: r.geometry.y + r.geometry.h - 24,
    attrs: {},
  });
  if (r.kind === 'meeting') {
    devices.push({
      code: `OCC-${r.code}`,
      name: `Occupancy sensor ${r.code}`,
      type: 'occupancy',
      room: r.code,
      x: c.x,
      y: c.y - 8,
      attrs: {},
    });
    devices.push({
      code: `PLUG-${r.code}-PROJ`,
      name: `Projector plug ${r.code}`,
      type: 'plug',
      room: r.code,
      appliance: 'projector',
      nominalPowerW: 280,
      standbyPowerW: 4,
      sweepable: true,
      x: c.x,
      y: c.y + 28,
      attrs: {},
    });
  }
  if (r.kind === 'pantry') {
    devices.push({
      code: `PLUG-${r.code}-FRIDGE`,
      name: 'Fridge plug',
      type: 'plug',
      room: r.code,
      appliance: 'fridge',
      nominalPowerW: 150,
      standbyPowerW: 60,
      sweepable: false,
      x: c.x - 60,
      y: c.y + 30,
      attrs: {},
    });
    devices.push({
      code: `PLUG-${r.code}-COFFEE`,
      name: 'Coffee machine plug',
      type: 'plug',
      room: r.code,
      appliance: 'coffee_machine',
      nominalPowerW: 1200,
      standbyPowerW: 8,
      sweepable: true,
      x: c.x + 60,
      y: c.y + 30,
      attrs: {},
    });
  }
  if (r.kind === 'open_plan') {
    for (let i = 1; i <= 6; i++) {
      const desk = desks.find((d) => d.code === `D-${n}.O-${String(i * 2).padStart(2, '0')}`);
      devices.push({
        code: `PLUG-${r.code}-MON${i}`,
        name: `Monitor plug ${r.code}/${i}`,
        type: 'plug',
        room: r.code,
        appliance: 'monitor',
        nominalPowerW: 35,
        standbyPowerW: 6,
        sweepable: true,
        x: desk.x + 30,
        y: desk.y - 30,
        attrs: {},
      });
    }
  }
}
for (const f of floors) {
  devices.push({
    code: `FM-${f.number}`,
    name: `Floor meter ${f.number}`,
    type: 'floor_meter',
    floor: f.number,
    coreLoadW: f.number === 2 ? 600 + 2500 : 600,
    attrs: {},
  });
}

const world = {
  site: { code: 'HQ', name: 'Headquarters' },
  building: { code: 'MAIN', name: 'Main building' },
  floors,
  zones,
  rooms,
  desks,
  devices,
};
writeFileSync(`${out}/world.json`, JSON.stringify(world, null, 2) + '\n');

const personas = {
  personas: [
    { key: 'early_bird', name: 'Early bird', arrive: '07:30', leave: '16:30', meetings: 1 },
    {
      key: 'standard',
      name: 'Standard',
      arrive: '09:00',
      leave: '18:00',
      meetings: 2,
      notes: 'Majority of staff',
    },
    {
      key: 'late_worker',
      name: 'Late worker',
      arrive: '10:00',
      leave: '21:30',
      meetings: 1,
      notes: 'Keeps a zone on at the evening sweep',
    },
    {
      key: 'meeting_heavy',
      name: 'Meeting heavy',
      arrive: '09:00',
      leave: '18:30',
      meetings: 4,
      notes: 'Moves between meeting rooms',
    },
    {
      key: 'remote_today',
      name: 'Remote today',
      arrive: null,
      leave: null,
      meetings: 0,
      notes: 'Laptop stays offline',
    },
  ],
};
writeFileSync(`${out}/personas.json`, JSON.stringify(personas, null, 2) + '\n');

// Fictional employee names (no real people).
const first = [
  'Amira',
  'Bilal',
  'Chandra',
  'Dalia',
  'Eshan',
  'Farah',
  'Ghassan',
  'Hana',
  'Idris',
  'Jumana',
  'Kareem',
  'Layla',
  'Marwan',
  'Nadia',
  'Omar',
  'Priya',
  'Qasim',
  'Rania',
  'Sami',
  'Tala',
  'Usman',
  'Vida',
  'Walid',
  'Yasmin',
  'Zayd',
  'Aisha',
  'Basel',
  'Dina',
  'Faris',
  'Huda',
  'Imran',
  'Lina',
  'Majid',
  'Noor',
  'Rami',
  'Salma',
  'Tariq',
  'Wafa',
  'Yousef',
  'Zara',
  'Adel',
  'Bushra',
  'Hadi',
  'Jana',
  'Karim',
  'Maha',
  'Nabil',
  'Reem',
];
const last = [
  'Haddad',
  'Rahman',
  'Nair',
  'Mansour',
  'Khoury',
  'Saleh',
  'Farouk',
  'Iyer',
  'Qureshi',
  'Zaman',
  'Aziz',
  'Sabbagh',
  'Nasser',
  'Hamdan',
  'Sheikh',
  'Malik',
  'Barakat',
  'Rashid',
  'Tahir',
  'Jaber',
  'Kassem',
  'Shah',
  'Darwish',
  'Hakim',
];
const departments = ['Finance', 'Sales', 'Engineering', 'Operations'];
const personaMix = [
  'standard',
  'standard',
  'standard',
  'standard',
  'standard',
  'standard',
  'early_bird',
  'early_bird',
  'late_worker',
  'meeting_heavy',
  'meeting_heavy',
  'remote_today',
];

function tenant(key, name, hostname, brand, locale, nameOffset) {
  const employees = [];
  let idx = 0;
  for (const f of floors) {
    for (let i = 0; i < 12; i++) {
      const code = `E${String(idx + 1).padStart(3, '0')}`;
      const fn = first[(idx * 7 + nameOffset) % first.length];
      const ln = last[(idx * 5 + nameOffset * 3) % last.length];
      const desk = `D-${f.number}.O-${String(i + 1).padStart(2, '0')}`;
      employees.push({
        code,
        name: `${fn} ${ln}`,
        department: departments[(idx + f.number) % 4],
        deskRoom: `${f.number}.O`,
        desk,
        persona: personaMix[i],
        email: `${fn}.${ln}`.toLowerCase() + `@${key}.demo`,
      });
      idx++;
    }
  }
  return {
    key,
    name,
    hostname,
    locale,
    currency: 'AED',
    tariffPerKwh: 0.44,
    demoMode: true,
    brand,
    employees,
  };
}
const alpha = tenant(
  'alpha',
  'Falcon Facilities Group',
  'alpha.localhost',
  {
    name: 'Falcon Facilities Group',
    shortName: 'Falcon',
    primaryColor: '#0B3D91',
    accentColor: '#F59E0B',
    logo: 'brands/alpha/logo.svg',
    favicon: 'brands/alpha/favicon.svg',
    fontFamily: 'Inter, system-ui, sans-serif',
    loginTagline: 'Every asset, every kilowatt, one platform.',
  },
  'en',
  0,
);
const beta = tenant(
  'beta',
  'Oasis Retail Holdings',
  'beta.localhost',
  {
    name: 'Oasis Retail Holdings',
    shortName: 'Oasis',
    primaryColor: '#B5451B',
    accentColor: '#0F766E',
    logo: 'brands/beta/logo.svg',
    favicon: 'brands/beta/favicon.svg',
    fontFamily: 'Inter, system-ui, sans-serif',
    loginTagline: 'Facilities intelligence for every store and office.',
  },
  'en',
  11,
);
writeFileSync(`${out}/tenants/alpha.json`, JSON.stringify(alpha, null, 2) + '\n');
writeFileSync(`${out}/tenants/beta.json`, JSON.stringify(beta, null, 2) + '\n');
console.log(
  `rooms=${rooms.length} desks=${desks.length} devices=${devices.length} employees=${alpha.employees.length}`,
);
