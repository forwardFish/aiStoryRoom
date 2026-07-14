# Many Worlds v1.4 P0 Closeout External Data Validation Matrix

本轮没有表格或外部数据导入，第三方支付仅按接口集成与签名回调进行验证。

## Status

`OUT_OF_SCOPE_WITH_REASON`: this task has no spreadsheet, CSV, SaaS table import or user-supplied external dataset. Therefore no external-data `unique_key`, `upsert` or table `readback` workflow is required.

Creem is an external API integration, not a bulk data import. Its validation belongs to API-BILL-01/API-BILL-02/API-WEBHOOK-01 and must use test/sandbox responses, verified Webhook signatures and internal database readback.

| External boundary | Allowed | Validation |
|---|---|---|
| Creem test/sandbox Checkout | yes | URL domain, provider id, signed Webhook, status mapping |
| Real production charge | no | guard must fail before redirect/mutation |
| WhatsApp/Telegram/Facebook/X share URL | URL construction only | encode text/url; popup fallback |
| Discord | share/copy behavior supported by browser | no false claim of native web intent |
| QR decoder | local deterministic library | decoded URL equals combinedInviteUrl |
