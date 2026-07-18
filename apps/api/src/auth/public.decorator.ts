import { SetMetadata } from "@nestjs/common";

export const PUBLIC_ROUTE_METADATA = "auth:public-route";
export const Public = () => SetMetadata(PUBLIC_ROUTE_METADATA, true);
