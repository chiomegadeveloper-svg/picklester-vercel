export type MayaProductCode =
  | "extra_5_games"
  | "pass_5_days"
  | "pass_1_week"
  | "pass_1_month"
  | "pass_forever"
  | "coins_30"
  | "coins_50"
  | "coins_100"
  | "coins_500"
  | "bg_midnight" | "bg_teal" | "bg_forest" | "bg_maroon" | "bg_royal" | "bg_ocean"
  | "bg_amber" | "bg_rose" | "bg_slate" | "bg_indigo" | "bg_emerald" | "bg_sunset"
  | "bg_neon_cyan" | "bg_neon_lime" | "bg_laser_blue" | "bg_hot_magenta" | "bg_plasma" | "bg_solar_orange";

export type MayaPassCode = MayaProductCode;

export type MayaPassProduct = {
  code: MayaProductCode;
  title: string;
  detail: string;
  amount: number;
  passDays: number | null;
  extraGames: number;
  coinReward: number;
  coinPackage: number;
  category: "gamepass" | "coins" | "background";
  coinPrice?: number;
  backgroundCss?: string;
};

export const MAYA_PASS_PRODUCTS: MayaPassProduct[] = [
  {
    code: "extra_5_games",
    title: "Additional 5 Games",
    detail: "Adds 5 extra official games after your free daily games are used",
    amount: 20,
    passDays: null,
    extraGames: 5,
    coinReward: 3,
    coinPackage: 0,
    category: "gamepass",
  },
  {
    code: "pass_5_days",
    title: "5-Day Pass",
    detail: "Unlimited games for 5 days",
    amount: 30,
    passDays: 5,
    extraGames: 0,
    coinReward: 5,
    coinPackage: 0,
    category: "gamepass",
  },
  {
    code: "pass_1_week",
    title: "Weekly Pass",
    detail: "Unlimited games for 1 week",
    amount: 40,
    passDays: 7,
    extraGames: 0,
    coinReward: 7,
    coinPackage: 0,
    category: "gamepass",
  },
  {
    code: "pass_1_month",
    title: "Monthly Pass",
    detail: "Unlimited games for 1 month",
    amount: 50,
    passDays: 30,
    extraGames: 0,
    coinReward: 10,
    coinPackage: 0,
    category: "gamepass",
  },
  {
    code: "pass_forever",
    title: "Forever Pass",
    detail: "Unlimited games with no expiry",
    amount: 1800,
    passDays: 0,
    extraGames: 0,
    coinReward: 100,
    coinPackage: 0,
    category: "gamepass",
  },
  {
    code: "coins_30",
    title: "30 Coins",
    detail: "Add 30 Picklester Coins to your wallet",
    amount: 50,
    passDays: null,
    extraGames: 0,
    coinReward: 30,
    coinPackage: 30,
    category: "coins",
  },
  {
    code: "coins_50",
    title: "50 Coins",
    detail: "Add 50 Picklester Coins to your wallet",
    amount: 80,
    passDays: null,
    extraGames: 0,
    coinReward: 50,
    coinPackage: 50,
    category: "coins",
  },
  {
    code: "coins_100",
    title: "100 Coins",
    detail: "Add 100 Picklester Coins to your wallet",
    amount: 120,
    passDays: null,
    extraGames: 0,
    coinReward: 100,
    coinPackage: 100,
    category: "coins",
  },
  {
    code: "coins_500",
    title: "500 Coins",
    detail: "Best-value Picklester Coin package",
    amount: 300,
    passDays: null,
    extraGames: 0,
    coinReward: 500,
    coinPackage: 500,
    category: "coins",
  },
  { code:"bg_midnight",title:"Midnight Blue",detail:"Deep blue Recent feed background",amount:10,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:30,backgroundCss:"linear-gradient(135deg,#0a1630,#111827)" },
  { code:"bg_teal",title:"Deep Teal",detail:"Calm teal Recent feed background",amount:25,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:45,backgroundCss:"linear-gradient(135deg,#073b3a,#102529)" },
  { code:"bg_forest",title:"Forest Green",detail:"Dark forest Recent feed background",amount:40,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:65,backgroundCss:"linear-gradient(135deg,#12351d,#111d16)" },
  { code:"bg_maroon",title:"Classic Maroon",detail:"Rich maroon Recent feed background",amount:60,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:90,backgroundCss:"linear-gradient(135deg,#4a1625,#20131a)" },
  { code:"bg_royal",title:"Royal Purple",detail:"Royal purple Recent feed background",amount:80,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:120,backgroundCss:"linear-gradient(135deg,#38186b,#17132a)" },
  { code:"bg_ocean",title:"Ocean Blue",detail:"Ocean-toned Recent feed background",amount:100,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:150,backgroundCss:"linear-gradient(135deg,#075985,#102331)" },
  { code:"bg_amber",title:"Golden Amber",detail:"Warm amber Recent feed background",amount:120,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:180,backgroundCss:"linear-gradient(135deg,#713f12,#261d10)" },
  { code:"bg_rose",title:"Dusty Rose",detail:"Soft rose Recent feed background",amount:145,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:215,backgroundCss:"linear-gradient(135deg,#713047,#28151e)" },
  { code:"bg_slate",title:"Steel Slate",detail:"Professional slate feed background",amount:175,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:250,backgroundCss:"linear-gradient(135deg,#334155,#141b25)" },
  { code:"bg_indigo",title:"Elite Indigo",detail:"Deep indigo Recent feed background",amount:210,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:295,backgroundCss:"linear-gradient(135deg,#312e81,#15162f)" },
  { code:"bg_emerald",title:"Premium Emerald",detail:"Emerald Recent feed background",amount:245,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:340,backgroundCss:"linear-gradient(135deg,#065f46,#10231d)" },
  { code:"bg_sunset",title:"Sunset Blend",detail:"Orange-purple Recent feed background",amount:280,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:388,backgroundCss:"linear-gradient(135deg,#9a3412,#581c87)" },
  { code:"bg_neon_cyan",title:"Electric Cyan",detail:"Glowing cyan Special background",amount:520,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:380,backgroundCss:"linear-gradient(135deg,#003b49,#06151c);box-shadow:inset 0 0 22px #00eaff66,0 0 12px #00eaff33" },
  { code:"bg_neon_lime",title:"Neon Lime",detail:"Picklester lime Special background",amount:580,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:500,backgroundCss:"linear-gradient(135deg,#263800,#0d1607);box-shadow:inset 0 0 22px #bdf40066,0 0 12px #bdf40033" },
  { code:"bg_laser_blue",title:"Laser Blue",detail:"Laser-blue Special background",amount:640,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:620,backgroundCss:"linear-gradient(135deg,#071b5b,#050b21);box-shadow:inset 0 0 22px #287bff77,0 0 12px #287bff33" },
  { code:"bg_hot_magenta",title:"Hot Magenta",detail:"Electric magenta Special background",amount:700,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:740,backgroundCss:"linear-gradient(135deg,#5b0647,#21051b);box-shadow:inset 0 0 22px #ff20d677,0 0 12px #ff20d633" },
  { code:"bg_plasma",title:"Plasma Purple",detail:"Plasma-purple Special background",amount:760,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:860,backgroundCss:"linear-gradient(135deg,#35106b,#160526);box-shadow:inset 0 0 22px #9d39ff77,0 0 12px #9d39ff33" },
  { code:"bg_solar_orange",title:"Solar Orange",detail:"Electric orange Special background",amount:820,passDays:null,extraGames:0,coinReward:0,coinPackage:0,category:"background",coinPrice:988,backgroundCss:"linear-gradient(135deg,#6b2400,#210d03);box-shadow:inset 0 0 22px #ff6a0077,0 0 12px #ff6a0033" },
];

export function getMayaPassProduct(code: string) {
  return MAYA_PASS_PRODUCTS.find((product) => product.code === code);
}
