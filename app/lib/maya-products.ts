export type MayaPassCode = "extra_5_games" | "pass_5_days" | "pass_1_week" | "pass_1_month" | "pass_forever";

export type MayaPassProduct = {
  code: MayaPassCode;
  title: string;
  detail: string;
  amount: number;
  passDays: number | null;
  extraGames: number;
};

export const MAYA_PASS_PRODUCTS: MayaPassProduct[] = [
  {
    code: "extra_5_games",
    title: "Additional 5 Games",
    detail: "Adds 5 extra official games after your free daily games are used",
    amount: 20,
    passDays: null,
    extraGames: 5,
  },
  {
    code: "pass_5_days",
    title: "5-Day Pass",
    detail: "Unlimited games for 5 days",
    amount: 30,
    passDays: 5,
    extraGames: 0,
  },
  {
    code: "pass_1_week",
    title: "Weekly Pass",
    detail: "Unlimited games for 1 week",
    amount: 40,
    passDays: 7,
    extraGames: 0,
  },
  {
    code: "pass_1_month",
    title: "Monthly Pass",
    detail: "Unlimited games for 1 month",
    amount: 50,
    passDays: 30,
    extraGames: 0,
  },
  {
    code: "pass_forever",
    title: "Forever Pass",
    detail: "Unlimited games with no expiry",
    amount: 1800,
    passDays: 0,
    extraGames: 0,
  },
];

export function getMayaPassProduct(code: string) {
  return MAYA_PASS_PRODUCTS.find((product) => product.code === code);
}
