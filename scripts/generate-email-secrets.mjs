import { createHash, randomBytes } from "node:crypto";

const capability = randomBytes(32).toString("base64url");
const wakeSecret = randomBytes(32).toString("base64url");
const salt = randomBytes(32);
const hash = createHash("sha256").update(salt).update(capability, "utf8").digest();

console.log("EMAIL_DB_CAPABILITY=" + capability);
console.log("EMAIL_WAKE_SECRET=" + wakeSecret);
console.log("Capability SQL:");
console.log(
  `select public.configure_email_sender_credential_hash('current', 1, '${salt.toString("hex")}', '${hash.toString("hex")}');`,
);
