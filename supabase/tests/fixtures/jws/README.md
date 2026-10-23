Test-only certificate chain shaped like Apple's StoreKit signing chain (P-384 root and
intermediate, P-256 leaf, Apple's OIDs 1.2.840.113635.100.6.2.1 / 1.2.840.113635.100.6.11.1).
Generated locally with openssl; trusted only by `appstore_verify_test.ts`. Production code pins
the real Apple Root CA - G3 and rejects this chain (covered by a test).
