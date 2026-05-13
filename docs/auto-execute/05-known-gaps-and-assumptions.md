# 05 Known Gaps and Assumptions

- The newest UI/2 images were already staged as add/delete/modify changes before implementation. They are treated as user-provided desired asset state.
- The mini program uses a shared insight route with kind parameters instead of twenty separate physical pages; each latest UI surface has a route entry point and data section.
- Admin UI is MVP observable, not production-authenticated admin. Real admin auth is non-P0.
- Mock WeChat, mock AI, mock audit remain intentionally in place with provider-like route/service boundaries.
- Real payment and 20_unlock_next_chapter are non-P0 placeholders.
