// Wrapped links from emails and chats (D-042).
//   npx deno test supabase/tests/linkUnwrap_test.ts
import { unwrapLink } from "../functions/_shared/linkUnwrap.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`expected ${expected}\n     got ${actual}`);
}

Deno.test("Outlook Safe Links (the owner's real director email)", () => {
  assertEquals(unwrapLink("https://na01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fcnrschedule.stlbasketball.com%2F&data=05%7C02%7C%7C4714301c0f684179d39808df3524bec7%7C84df9e7fe9f640afb435aaaaaaaaaaaa%7C1%7C0%7C639288104079698901%7CUnknown%7CTWFpbGZsb3d8eyJFbXB0eU1hcGkiOnRydWUsIlYiOiIwLjAuMDAwMCIsIlAiOiJXaW4zMiIsIkFOIjoiTWFpbCIsIldUIjoyfQ%3D%3D%7C0%7C%7C%7C&sdata=K1NXcVYJum5kjDiHppW0zY5seDICBZ%2Fpsa26%2B4X0Sl4%3D&reserved=0"), "https://cnrschedule.stlbasketball.com/");
  assertEquals(unwrapLink("https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fdocs.google.com%2Fspreadsheets%2Fd%2Fe%2F2PACX-abc%2Fpubhtml&data=x"), "https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml");
});

Deno.test("Google, Facebook and Proofpoint wrappers", () => {
  assertEquals(unwrapLink("https://www.google.com/url?q=https://cnrschedule.stlbasketball.com/teams/x&sa=D&source=editors"), "https://cnrschedule.stlbasketball.com/teams/x");
  assertEquals(unwrapLink("https://l.facebook.com/l.php?u=https%3A%2F%2Fcnrschedule.stlbasketball.com%2F&h=AT0"), "https://cnrschedule.stlbasketball.com/");
  assertEquals(unwrapLink("https://urldefense.proofpoint.com/v2/url?u=https-3A__cnrschedule.stlbasketball.com_teams_3d-2Dnation&d=DwM&c=x"), "https://cnrschedule.stlbasketball.com/teams/3d-nation");
  assertEquals(unwrapLink("https://urldefense.com/v3/__https://cnrschedule.stlbasketball.com/__;!!abc$"), "https://cnrschedule.stlbasketball.com/");
});

Deno.test("nested wrappers, brackets, and links that aren't wrapped", () => {
  const inner = "https://na01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fcnrschedule.stlbasketball.com%2F";
  assertEquals(unwrapLink(`https://www.google.com/url?q=${encodeURIComponent(inner)}`), "https://cnrschedule.stlbasketball.com/");
  assertEquals(unwrapLink("  <https://cnrschedule.stlbasketball.com/>  "), "https://cnrschedule.stlbasketball.com/");
  assertEquals(unwrapLink("https://cnrschedule.stlbasketball.com/"), "https://cnrschedule.stlbasketball.com/");
  assertEquals(unwrapLink("not a link"), "not a link");
});
