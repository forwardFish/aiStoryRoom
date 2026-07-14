import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { getMvpStory } from "./mvp-catalog";

type RuntimeWorld = {
  id: string;
  runtimeId: "sangtian" | "caesar";
  title: string;
  description: string;
  heroCover: string;
  totalDays: number;
  minPlayers: number;
  maxPlayers: number;
  playable: true;
  modes: Array<"solo" | "multiplayer">;
};

const RUNTIME_WORLDS: RuntimeWorld[] = [
  {
    id: "sangtian", runtimeId: "sangtian", title: "嘉靖财政危局",
    description: "在七轮财政与权谋危机中作出会影响所有角色的决定。",
    heroCover: "/assets/stories/sangtian-hero.webp", totalDays: 7, minPlayers: 3, maxPlayers: 3,
    playable: true, modes: ["solo", "multiplayer"]
  },
  {
    id: "caesar_last_spring", runtimeId: "caesar", title: "Caesar: The Last Spring of the Republic",
    description: "在罗马共和国的最后七幕中重写联盟、秩序与结局。",
    heroCover: "/assets/bg/1.png", totalDays: 7, minPlayers: 3, maxPlayers: 6,
    playable: true, modes: ["solo", "multiplayer"]
  }
];

function findWorld(worldId: string) {
  const world = RUNTIME_WORLDS.find((item) => item.id === worldId || item.runtimeId === worldId);
  if (!world) return null;
  const story = getMvpStory(world.runtimeId);
  return {
    ...world,
    roles: story.roles.map((role) => ({
      key: role.key,
      name: role.name,
      portrait: role.portrait,
      playableSolo: role.playable,
      playableMultiplayer: world.runtimeId === "sangtian"
        ? ["zhejiang_governor", "xunfu", "county_magistrate"].includes(role.key)
        : true
    }))
  };
}

/** Runtime-facing registry.  Preview cards deliberately have no entry here. */
@Controller("v4/worlds")
export class WorldsController {
  @Get()
  list() {
    return { worlds: RUNTIME_WORLDS };
  }

  @Get(":worldId")
  detail(@Param("worldId") worldId: string) {
    const world = findWorld(worldId);
    if (!world) throw new NotFoundException({ code: "WORLD_NOT_FOUND", message: "World not found" });
    return world;
  }
}
