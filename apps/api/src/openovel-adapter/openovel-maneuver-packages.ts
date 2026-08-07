import { installOpenNovelManeuverGuardStages } from "./openovel-maneuver-guard-stages";
import { OpenNovelManeuverPackageRegistry } from "./openovel-maneuver-package";
import { sangtianOpenNovelManeuverPackage } from "./sangtian-openovel-maneuver.package";

const registeredPackages = [
  sangtianOpenNovelManeuverPackage,
] as const;

for (const maneuverPackage of registeredPackages) {
  installOpenNovelManeuverGuardStages(maneuverPackage);
}

export const openNovelManeuverPackages = new OpenNovelManeuverPackageRegistry(
  registeredPackages,
);
