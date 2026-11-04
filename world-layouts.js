// Authored apartment layouts. Each block is 16 x 13 cells.
// Row 0 faces the building corridor (front door), row 12 is the exterior wall.
// Legend
//   #  wall          D  door        _  open archway     w  window      :  balcony railing
//   .  floor         ~  rug         *  broken glass     =  squeaky board
//   Room markers (floor): l living  k kitchen  b bathroom  r bedroom  o office
//                         s storage y balcony  u laundry   h hall
//   Furniture: B bed  W wardrobe(hide)  T table  K counter  F fridge  O sofa  A armchair
//              V tv stand  E desk(hide under)  H bookshelf  U bathtub(hide)  L toilet
//              N sink  M washer  X crate  G plant  I cabinet
//   Markers (floor): 1 guard post  2 hostage  3 supply  4 intel  5 entry  6 extraction  7 camera

export const APARTMENTS = [
  {
    id: 'A1', name: 'Corner Family Flat', plaster: '#8c8a70',
    rows: [
      '###D############',
      '#h.5.#l....HH..#',
      '#....D..~~~~..A#',
      '#W...#.O~~~~V..#',
      '##D###.O~~~~V.1#',
      '#k.KK#.........#',
      '#.TT.D....2....#',
      '#.TT.#.....3...#',
      '#F..1######D####',
      '###D##r.....BBW#',
      '#L..U#...E..BB.#',
      '#Nb.U#.4.E.2.6.#',
      '#w##w##w##w##w##',
    ],
  },
  {
    id: 'A2', name: 'Studio & Office', plaster: '#7f8576',
    rows: [
      '############D###',
      '#kKKK#l..HH#5h.#',
      '#...F#..~~~D...#',
      '#.TT._..~~~#.1.#',
      '#.TT.#.O~~~#W..#',
      '#..2.#.O..V##D##',
      '##D###...2.#b.L#',
      '#r..W###D###N.U#',
      '#...W#.E..H#..U#',
      '#.BB.D.E.o.##D##',
      '#.BB.#..4..D..M#',
      '#1.2.#3....#u6M#',
      '##w#w##w#w###w##',
    ],
  },
  {
    id: 'A3', name: 'Balcony Apartment', plaster: '#8f8063',
    rows: [
      '#######D########',
      '#k.KKF#5h#bUU..#',
      '#K....D..D.L..N#',
      '#.TT.3#..#..=..#',
      '#.TT..#..#######',
      '#..2..#1.Dr...W#',
      '###D###__#....W#',
      '#l.....~~#.BB..#',
      '#.OO..V~~#.BB.2#',
      '#...A.V.2#...E4#',
      '###D########D###',
      '#y..G...*..1.6.#',
      '#::::::::::::::#',
    ],
  },
  {
    id: 'A4', name: 'Long Hallway Flat', plaster: '#78806f',
    rows: [
      '#D##############',
      '#5h#l...HH4...A#',
      '#..D..~~~~..TT.#',
      '#.1#.O~~~~..TT.#',
      '#..#.O..V.2....#',
      '#..#########D###',
      '#..Dk.KKK#sX..X#',
      '#*.#.TTF.D..3.X#',
      '#..#########D###',
      '#.=#bL..#r....W#',
      '#..D...U#..BB.2#',
      '#1.#N..U#E.BB6.#',
      '#w####w###w##w##',
    ],
  },
  {
    id: 'A5', name: 'Open Loft', plaster: '#857a68',
    rows: [
      '########D#######',
      '#kKKF#h.5.#oG..#',
      '#....#.~~.D...E#',
      '#..TT#.1..#.43E#',
      '##D####__###D###',
      '#l.~~~~~~.HH...#',
      '#.O~~~~~~.V..A.#',
      '#.O~~~~~~.V.2..#',
      '###D####D###D###',
      '#r..W.#b.L#u.M.#',
      '#BB.1.D..U#.2..#',
      '#BB..6#N.U#3..G#',
      '##w###w##w##w###',
    ],
  },
  {
    id: 'A6', name: 'Split Bedroom Flat', plaster: '#7d8574',
    rows: [
      '#############D##',
      '#r.WW.H#Ub#.h5.#',
      '#......#U.D..1.#',
      '#.BB...#LN#....#',
      '#.BB.2.#####D###',
      '#E.....D.l.~~~.#',
      '###D####O.~~~V.#',
      '#k..KKF#O.~~~V.#',
      '#K.....#....A.3#',
      '#K.TT..D.2..#D##',
      '#F.TT..#..1.#sX#',
      '#..4..6#.*..#.X#',
      '#w###w##w#w#####',
    ],
  },
  {
    id: 'A7', name: 'Twin Bedroom Flat', plaster: '#8a8268',
    rows: [
      '#####D##########',
      '#r..#5h.#l.HH.A#',
      '#W..D...D..~~~.#',
      '#W..#.1.#.O~~~V#',
      '#BB.#...#.O~~~V#',
      '#BB2#.*.#..3...#',
      '#####D###.2..E.#',
      '#kKKF.#b.###D###',
      '#.....#L.#r...W#',
      '#.TT..D..#.BB.W#',
      '#.TT.1#U.D.BB.2#',
      '#4...G#UN#E..6.#',
      '#w#w##w##w##w#w#',
    ],
  },
  {
    id: 'A8', name: 'Office Suite', plaster: '#7a7f7a',
    rows: [
      '##########D#####',
      '#oHH...#.h5.#bU#',
      '#..E.A.D...1#.U#',
      '#..E4..#....D.L#',
      '#X..3.X#..*.#.N#',
      '###D#####__#####',
      '#r..W.#l.~~~~..#',
      '#...W.#.O~~~~V.#',
      '#.BB..D.O..#D###',
      '#.BB.2#..2#k.KK#',
      '#W...1#.G.#.TTF#',
      '#W..*.#..3#..6K#',
      '#w##w##w###w##w#',
    ],
  },
  {
    id: 'A9', name: 'Garden Balcony Flat', plaster: '#887e69',
    rows: [
      '####D###########',
      '#h.W5#l...HH..A#',
      '#....D.~~~~~..V#',
      '#G.1.#.~~~~~..V#',
      '##D###.OOO..3..#',
      '#K.K.D...2...1.#',
      '#k..F###D####D##',
      '#TT..#rW...#L.U#',
      '###D##...BB#N.U#',
      '#MM.u#.E.BB#b.4#',
      '###D####D####D##',
      '#y..G.6..*..2.G#',
      '#::::::::::::::#',
    ],
  },
];

// Floors (bottom to top). Apartment letters on each floor are A, B, C (west to east).
export const FLOORS = [
  { name: 'Floor 1', apts: ['A1', 'A2', 'A3'], tint: '#6f6a5c' },
  { name: 'Floor 2', apts: ['A4', 'A5', 'A6'], tint: '#646a60' },
  { name: 'Floor 3', apts: ['A7', 'A8', 'A9'], tint: '#6b6358' },
];

// Corridor decoration per floor: 3 rows (y=1..3) from x=3 to x=49.
// Characters: , corridor floor  X crate  G plant  * glass  = squeak  1 guard post  7 camera  I cabinet
export const CORRIDOR_DECOR = [
  { 1: { 9: 'G', 25: '7', 33: 'I', 48: 'X' }, 2: { 14: '1', 40: '*', 41: '*' }, 3: { 22: '=', 30: 'X', 46: 'G' } },
  { 1: { 12: 'X', 13: 'X', 25: '7', 45: 'G' }, 2: { 28: '1', 8: '=' }, 3: { 18: 'G', 36: '*', 47: 'I' } },
  { 1: { 16: 'I', 25: '7', 38: 'G' }, 2: { 20: '1', 44: '=' }, 3: { 10: '*', 11: '*', 29: 'X', 48: 'X' } },
];

export const TUTORIAL = {
  id: 'TUT', name: 'Training Flat', plaster: '#7c806e',
  rows: [
    '########################',
    '#h5...W#l..............#',
    '#.....W#..W............#',
    '#..T..*D..............G#',
    '#..T...#..O...........G#',
    '#......#...............#',
    '###########D############',
    '########o.E....#r..W..6#',
    '########.......#.......#',
    '########.......D....2..#',
    '########....1..#.BB....#',
    '########.X...X.#.BB.E..#',
    '########################',
  ],
};
