import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourceRoot = resolve("C:/Users/linyanhui/Downloads/ourmanyworlds-legal-pages/ourmanyworlds-legal");
const targetRoot = resolve("apps/web/public/legal");
const pages = ["privacy-policy.md", "terms-of-service.md", "refund-policy.md", "DEPLOYMENT-CHECKLIST.md"];

await mkdir(targetRoot, { recursive: true });
for (const page of pages) {
  const target = resolve(targetRoot, page);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(sourceRoot, page), target);
}

console.log(JSON.stringify({ status: "PASS", imported: pages, targetRoot }));
