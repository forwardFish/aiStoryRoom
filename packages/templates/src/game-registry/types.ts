export type GameStatus = "coming_soon" | "playable" | "hidden";

export type GameRoleDefinition = {
  roleKey: string;
  roleName: string;
  identity: string;
  publicInfo: string;
  hiddenSecret: string;
  personalGoal: string;
  currentState: string;
  abilityText: string;
  arcText: string;
  knownInfo: string[];
  cannotDo: string[];
  portrait: string;
  canBeHumanControlled: true;
  canBeAiControlled: true;
};

export type GameDefinition = {
  schemaVersion: "game_definition_v1";
  worldId: string;
  publicId: string;
  aliases: string[];
  templateId: string;
  status: GameStatus;
  catalog: {
    title: string;
    subtitle: string;
    description: string;
    genre: string;
    tags: string[];
    durationLabel: string;
    cardCover: string;
    heroCover: string;
    lobby?: {
      title: string;
      description: string;
      categoryLabel: string;
    };
  };
  modes: {
    solo: boolean;
    multiplayer: boolean;
    minHumanPlayers: number;
    maxHumanPlayers: number;
  };
  engine: {
    engineVersion: string;
    strategyVersion: string;
    strategyRegistryPath: string | null;
    fixedRules: null | {
      stageCount: 7;
      mainCardsPerRoleStage: 3;
    };
  };
  worldActor: null | {
    actorKey: string;
    actorName: string;
    description: string;
    portrait: string;
  };
  presentation: {
    locationLabel: string;
    roundLabel: string;
    finaleLabel: string;
    sceneBackground: string;
    assetManifest: string | null;
    accent: string;
    accentSoft: string;
  };
  roles: GameRoleDefinition[];
};

export type GameRegistryEntry = {
  worldId: string;
  definitionPath: string;
};

export type GameRegistryIndex = {
  schemaVersion: "game_registry_v1";
  games: GameRegistryEntry[];
};

export type LoadedGameRegistry = {
  index: GameRegistryIndex;
  games: GameDefinition[];
  byWorldId: ReadonlyMap<string, GameDefinition>;
  byTemplateId: ReadonlyMap<string, GameDefinition>;
};
