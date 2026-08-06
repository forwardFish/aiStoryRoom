import { OpenNovelManeuverPackageRegistry } from "./openovel-maneuver-package";
import { sangtianOpenNovelManeuverPackage } from "./sangtian-openovel-maneuver.package";

export const openNovelManeuverPackages = new OpenNovelManeuverPackageRegistry([
  sangtianOpenNovelManeuverPackage,
]);
