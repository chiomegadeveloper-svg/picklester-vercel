export const PICKLESTER_ORIGIN = "https://www.picklester.asia";

export function picklesterUrl(path = "/") {
  return new URL(path, PICKLESTER_ORIGIN).toString();
}
