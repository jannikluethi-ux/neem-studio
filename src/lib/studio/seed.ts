import type { Actor, CharacterBody, StudioDb } from "./types.ts";
import {
  approveBrand,
  approveCharacter,
  approveScript,
  approveStory,
  approveStoryRules,
  approveUniverse,
  approveWorld,
  createCharacter,
  createEmptyDb,
  createLocation,
  createStudio,
  generateScript,
  generateStoryboard,
  generateStoryCandidates,
  openEpisode,
  reviewHindi,
  runQa,
  saveBrand,
  saveStoryRules,
  saveUniverse,
  saveWorld,
  setAgeBand,
} from "./engine.ts";

const NOW = "2026-10-07T08:00:00.000Z";
const human: Actor = { type: "human", id: "human_asha", name: "Asha Menon" };

function voice(id: string): CharacterBody["voiceProfile"] {
  return {
    ageImpression: "child",
    pitch: "medium",
    tempo: "unhurried",
    energy: "warm",
    accent: "everyday Hindi",
    pronunciation: "Simple words. No formal diction.",
    emotionalRange: "gentle",
    provider: "unassigned",
    commercialRights: "not-cleared",
    voiceId: id,
  };
}

function must(result: { ok: boolean; db: StudioDb; error?: string }): StudioDb {
  if (!result.ok) throw new Error(result.error ?? "seed step failed");
  return result.db;
}

export function buildSeedDb() {
  let db = createEmptyDb();
  db = must(createStudio(db, { name: "Neem Studio", reviewerName: "Asha Menon" }, human, NOW));
  db = must(setAgeBand(db, "3-5", human, NOW));
  db = must(
    saveBrand(
      db,
      {
        name: "Gulmohar Gali",
        nameHi: "गुलमोहर गली",
        tagline: "A small lane. A new story. No copies.",
        taglineHi: "जहाँ हर दिन एक छोटी कहानी खिलती है",
        colors: ["#1F6B4A", "#E08A2C", "#1C1915", "#F4EFE6"],
        voice: "Warm, specific, never shouty. Parents should trust a replay.",
        parentPositioning: "Original Hindi stories for young children. Production uses software. The product is the characters and the stories.",
        notPositioning: "Not an AI cartoon generator. Not a volume channel.",
      },
      human,
      NOW,
    ),
  );
  db = must(approveBrand(db, human, NOW));
  db = must(
    saveUniverse(
      db,
      {
        name: "Gulmohar Gali",
        premise: "One residential lane in a mid-size Indian city. Stories stay at child scale.",
        rules: ["No magic powers.", "No branded toys.", "Adults help. They do not punchline the child.", "Festivals are lived, not lectured."],
      },
      human,
      NOW,
    ),
  );
  db = must(approveUniverse(db, human, NOW));
  db = must(
    saveWorld(
      db,
      {
        name: "The lane under the gulmohar",
        geography: "A ground-floor home, a courtyard tree, a sabzi stall at the corner, a footbridge at the end.",
        timeFeel: "The present. Monsoon, summer, and one festival at a time.",
        rules: ["The tree does not talk.", "Animals are animals.", "The city stays off-screen except the train."],
      },
      human,
      NOW,
    ),
  );
  db = must(approveWorld(db, human, NOW));

  const places = [
    ["courtyard", "Courtyard", "आँगन", "Packed earth, one gulmohar, a tulsi by the step."],
    ["veranda", "Veranda", "बरामदा", "Cool floor. Rain is watched from here."],
    ["kitchen", "Kitchen", "रसोई", "Steel glasses, a jug, a low table."],
    ["lane", "Lane", "गली", "Narrow, lived-in, one swing, one sabzi stall."],
    ["bridge", "Footbridge", "पुल", "Where the local train can be seen, not chased."],
  ] as const;
  for (const [key, name, nameHi, description] of places) {
    db = must(createLocation(db, { key, name, nameHi, description, kind: "world" }, human, NOW));
  }

  const characters: CharacterBody[] = [
    {
      name: "Meethi",
      nameHi: "मीठी",
      age: "5",
      species: "human",
      personality: "She notices what other people walk past, then wants to act before she has finished looking.",
      strengths: ["attention", "warmth"],
      weaknesses: ["impatience"],
      likes: ["mango", "drawing on scrap paper", "the gulmohar"],
      dislikes: ["being pulled away mid-look"],
      fears: ["thunder"],
      relationshipNotes: ["Dadi Kamla's granddaughter.", "Golu's friend."],
      appearance: "Five. Short black hair. Dark brown eyes. A red ribbon that stays red.",
      hair: "Short black hair",
      eyes: "Dark brown eyes",
      accessories: "A red ribbon",
      clothing: "mustard kurta and teal salwar",
      colorPalette: ["#E08A2C", "#1F6B4A", "#9C341F"],
      voiceProfile: { ...voice("voice_meethi"), pitch: "medium-high", tempo: "faster when excited", ageImpression: "five" },
      speechStyle: "Short lines. Asks one question. Catchphrase is exact.",
      catchphrases: ["देखो ना!"],
      characterArc: "From grabbing the moment to staying with it.",
      storyFunction: "lead",
      visualRules: ["Ribbon stays red.", "No costume changes inside an episode.", "Eyes stay dark brown."],
      forbiddenVariations: ["cape", "princess dress", "magic wand", "brand logo"],
      developmentTokens: ["impatience", "thunder", "honesty", "sharing", "friendship", "curiosity", "consent"],
    },
    {
      name: "Golu",
      nameHi: "गोलू",
      age: "young",
      species: "palm squirrel",
      personality: "Loyal, hungry, easily sure of a wrong idea.",
      strengths: ["loyalty"],
      weaknesses: ["jumping to conclusions"],
      likes: ["the courtyard tree", "a tiny green cloth"],
      dislikes: ["sudden grabs"],
      fears: ["being left on the step"],
      relationshipNotes: ["Lives in the gulmohar. Meethi's friend. Not a talking sidekick with jokes for adults."],
      appearance: "Warm grey-brown, cream belly. Three of his own stripes, not a borrowed design. A small green cloth Meethi tied.",
      body: "Warm grey-brown, cream belly. Three of his own stripes.",
      accessories: "a small green cloth",
      clothing: "a small green cloth, nothing else",
      colorPalette: ["#8A6A45", "#F3E6CF", "#1F6B4A"],
      voiceProfile: { ...voice("voice_golu"), pitch: "high", tempo: "short bursts", energy: "quick", ageImpression: "small animal" },
      speechStyle: "Very few words. Sounds, then one short line.",
      catchphrases: ["चूँ… एक और?"],
      characterArc: "Learning that a missing thing is not always taken.",
      storyFunction: "friend",
      visualRules: ["No shirt, no shoes, no backpack.", "Green cloth stays small."],
      forbiddenVariations: ["chipmunk hoodie", "cape", "human hands"],
      developmentTokens: ["honesty", "friendship"],
    },
    {
      name: "Dadi Kamla",
      nameHi: "दादी कमला",
      age: "68",
      species: "human",
      personality: "Says one true thing and then stops. Does not pile on the moral.",
      strengths: ["patience", "timing"],
      weaknesses: ["will not hurry a story"],
      likes: ["nimbu pani", "the veranda"],
      dislikes: ["shouting over a child"],
      fears: ["none played for comedy"],
      relationshipNotes: ["Meethi's grandmother. She is not the joke."],
      appearance: "White cotton sari with a thin marigold border. Steel bangles. Grey hair in a low bun.",
      hair: "Grey hair in a low bun",
      accessories: "Steel bangles",
      clothing: "white sari with a marigold border",
      colorPalette: ["#F4EFE6", "#E08A2C", "#C0C4C8"],
      voiceProfile: { ...voice("voice_dadi"), pitch: "low-medium", tempo: "slow", energy: "steady", ageImpression: "grandmother" },
      speechStyle: "One sentence. Then quiet.",
      catchphrases: ["धीरे, बेटा।"],
      characterArc: "Keeps the house steady while Meethi learns the pace.",
      storyFunction: "elder",
      visualRules: ["Sari border stays marigold.", "No spectacles on and off between shots."],
      forbiddenVariations: ["cartoon scolding stick", "cape"],
      developmentTokens: ["patience"],
    },
  ];

  const ids: string[] = [];
  for (const body of characters) {
    const made = createCharacter(db, body, human, NOW);
    db = must(made);
    if (made.ok) ids.push(made.data.id);
  }
  for (const id of ids) db = must(approveCharacter(db, id, human, "Locked for the Gulmohar Gali canon.", NOW));
  const [meethiId, goluId, dadiId] = ids;
  if (meethiId && goluId && dadiId) {
    db = {
      ...db,
      relationships: [
        { id: "rel_meethi_dadi", fromId: meethiId, toId: dadiId, kind: "grandmother", note: "Dadi Kamla raises Meethi in the lane house." },
        { id: "rel_meethi_golu", fromId: meethiId, toId: goluId, kind: "friend", note: "Golu lives in the gulmohar. He is not a mascot." },
      ],
    };
  }

  db = must(
    saveStoryRules(
      db,
      {
        ageBand: "3-5",
        mustHave: ["A beginning, a trouble, and a resolution.", "A reason a Hindi-speaking child in India would care.", "Room for a parent to replay it."],
        never: ["A copied character.", "A villain speech.", "Danger as a joke.", "A product to buy.", "The same plot with nouns swapped."],
        tone: "Warm, concrete, a little funny, never sarcastic.",
        hindiRegister: "Spoken children's Hindi. Short lines. No newsroom Hindi. No machine-literal English.",
      },
      human,
      NOW,
    ),
  );
  db = must(approveStoryRules(db, human, NOW));

  const stories = generateStoryCandidates(db, 10, "agent_story_architect", NOW);
  db = must(stories);
  if (!stories.ok) return db;
  const good = db.stories.find((story) => {
    const snap = story.versions[story.versions.length - 1]?.snapshot;
    return snap && snap.originality.meetsThreshold && !snap.similarity.tooSimilar && snap.blueprintKey === "thunder-count";
  });
  const pick = good ?? db.stories.find((story) => {
    const snap = story.versions[story.versions.length - 1]?.snapshot;
    return snap && snap.originality.meetsThreshold && !snap.similarity.tooSimilar;
  });
  if (!pick) return db;
  db = must(approveStory(db, pick.id, human, "Editorial: thunder stays honest. Do not cure the fear with a joke.", NOW));
  const episode = openEpisode(db, pick.id, human, NOW);
  db = must(episode);
  const script = generateScript(db, pick.id, "agent_scriptwriter", NOW);
  db = must(script);
  if (!script.ok || !episode.ok) return db;
  db = must(reviewHindi(db, script.data.scriptId, "agent_hindi_editor", NOW));
  db = must(approveScript(db, script.data.scriptId, human, "Lines are short. Catchphrase is exact. Native review still required before any release.", NOW));
  db = must(generateStoryboard(db, script.data.scriptId, "agent_storyboard_director", NOW));
  db = must(runQa(db, episode.data.id, "agent_qa", NOW));
  return db;
}
