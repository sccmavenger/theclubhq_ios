// RFC 8291 Section 5 worked example: our encryption must reproduce it byte for byte.
//   npx deno test --allow-env supabase/tests/webpush_test.ts
import { encryptPayload } from "../functions/_shared/webpush.ts";
import { base64UrlDecode, base64UrlEncode } from "../functions/_shared/http.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`expected\n${expected}\ngot\n${actual}`);
}

Deno.test("aes128gcm matches the RFC 8291 example", async () => {
  const asPublic = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
  const asPrivate = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
  const point = base64UrlDecode(asPublic);
  const privateKey = await crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", d: asPrivate,
    x: base64UrlEncode(point.slice(1, 33)), y: base64UrlEncode(point.slice(33, 65)),
  }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);

  const body = await encryptPayload(
    new TextEncoder().encode("When I grow up, I want to be a watermelon"),
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    "BTBZMqHH6r4Tts7J_aSIgg",
    { privateKey, publicRaw: point },
    base64UrlDecode("DGv6ra1nlYgDCS1FRnbzlw"),
  );
  assertEquals(
    base64UrlEncode(body),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});
