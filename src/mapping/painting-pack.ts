export type ZoneRole =
  | "pad"
  | "epiano"
  | "perc"
  | "pattern-melody"
  | "pattern-rhythm"
  | "macro"
  | "accent";

export type Zone = {
  id: string;
  x: number;
  y: number;
  r: number;
  role: ZoneRole;
};

export type PaintingPack = {
  id: string;
  title: string;
  referenceImage: string;
  zones: Zone[];
};

export const OBRA_BOSS: PaintingPack = {
  id: "obra_boss",
  title: "El Boss Supremo",
  referenceImage: "/paintings/obra_boss/ref.jpg",
  zones: [
    // 🟥 PAREDES – PAD
    { id: "wall_l", x: 0.18, y: 0.45, r: 0.18, role: "pad" },
    { id: "wall_r", x: 0.82, y: 0.45, r: 0.18, role: "pad" },

    // 🧠 TECHO – MACRO
    { id: "ceiling", x: 0.5, y: 0.15, r: 0.15, role: "macro" },

    // 🥩 CARNE – PATRÓN MELÓDICO
    { id: "meat", x: 0.52, y: 0.38, r: 0.09, role: "pattern-melody" },

    // 🧤 MANO – PATRÓN RÍTMICO
    { id: "hand", x: 0.65, y: 0.78, r: 0.1, role: "pattern-rhythm" },

    // 🔪 CUCHILLO – ACENTO
    { id: "knife", x: 0.77, y: 0.55, r: 0.06, role: "accent" },

    // 💻 CMD – MUTADOR
    { id: "cmd", x: 0.28, y: 0.65, r: 0.1, role: "macro" },
  ],
};
