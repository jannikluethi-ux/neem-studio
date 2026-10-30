export interface BlueprintLine {
  who: "lead" | "support";
  hi: string;
  en: string;
  catchphrase?: boolean;
}

export interface BlueprintScene {
  settingKey: string;
  action: string;
  lines: BlueprintLine[];
}

export interface StoryBlueprint {
  key: string;
  title: string;
  titleHi: string;
  logline: string;
  theme: string;
  conflict: string;
  emotionalArc: string;
  emotionalObjective: string;
  learningObjective: string;
  learningKey: string;
  value: string;
  beginning: string;
  middle: string;
  resolution: string;
  resolutionType: string;
  culturalElement: string;
  culturalSpecificity: "specific" | "generic" | "none";
  humor: string;
  adventure: string;
  mystery: string;
  songUsage: "none" | "motif" | "full-song";
  visualMotif: string;
  storyStructure: string;
  developmentHook: string | null;
  thin: boolean;
  settingKey: string;
  wantsSupport: boolean;
  vocabulary: Array<{ word: string; meaning: string; pronunciation: string }>;
  scenes: BlueprintScene[];
}

const lead = (hi: string, en: string, catchphrase = false): BlueprintLine => ({
  who: "lead",
  hi,
  en,
  catchphrase,
});
const support = (hi: string, en: string): BlueprintLine => ({ who: "support", hi, en });

export const BLUEPRINTS: StoryBlueprint[] = [
  {
    key: "gulmohar-last-flower",
    storyStructure: "leave-shared-blossom",
    title: "The Last Gulmohar",
    titleHi: "आखिरी गुलमोहर",
    logline: "Meethi wants the last red flower for Dadi, then notices the bee got there first.",
    theme: "care before collecting",
    conflict: "want-the-last-flower",
    emotionalArc: "impulse-to-care",
    emotionalObjective: "The child feels the tug of wanting, then the quieter pleasure of leaving something.",
    learningObjective: "Look before you pick. Some beautiful things stay shared if we leave them.",
    learningKey: "leave-the-flower",
    value: "care",
    beginning:
      "{{name}} sees one gulmohar flower still on the courtyard tree. {{weakness}} shows up at once: she wants it in her hand now, for someone she loves.",
    middle:
      "A bee is already working the flower. {{name}} lifts her heel, stops, and watches the bee finish. Support, if present, waits with her instead of grabbing.",
    resolution:
      "She does not pick it. She draws the flower and gives the drawing instead. The tree keeps the last blossom.",
    resolutionType: "substitute-gift",
    culturalElement: "Courtyard gulmohar in flower; a drawing given at home instead of a plucked blossom.",
    culturalSpecificity: "specific",
    humor: "bee-gets-there-first",
    adventure: "none",
    mystery: "none",
    songUsage: "none",
    visualMotif: "one-red-gulmohar",
    developmentHook: "impatience",
    thin: false,
    settingKey: "courtyard",
    wantsSupport: true,
    vocabulary: [
      { word: "गुलमोहर", meaning: "gulmohar tree", pronunciation: "gul-mo-har" },
      { word: "आँगन", meaning: "courtyard", pronunciation: "aan-gan" },
      { word: "भौंरा", meaning: "bee", pronunciation: "bhaun-raa" },
    ],
    scenes: [
      {
        settingKey: "courtyard",
        action:
          "{{nameHi}} is in {{clothing}}. One red gulmohar remains. Her old trouble is {{weakness}}. She reaches, then sees a bee.",
        lines: [
          lead("", "", true),
          lead("एक फूल बचा है। मैं अभी तोड़ूँ?", "One flower is left. Shall I pick it now?"),
        ],
      },
      {
        settingKey: "courtyard",
        action: "The bee stays on the blossom. {{nameHi}} puts her hand behind her back.",
        lines: [
          support("रुक। भौंरा काम कर रहा है।", "Wait. The bee is working."),
          lead("ठीक है। फूल पेड़ पर रहेगा।", "All right. The flower stays on the tree."),
        ],
      },
      {
        settingKey: "kitchen",
        action: "She gives a drawing of the flower, not the flower.",
        lines: [lead("यह रहा फूल। असली वाला सबके लिए है।", "Here is the flower. The real one is for everyone.")],
      },
    ],
  },
  {
    key: "thunder-count",
    storyStructure: "fear-named-with-company",
    title: "Count the Thunder",
    titleHi: "गरज को गिनो",
    logline: "Thunder frightens her. She stays on the veranda and counts the gap after the lightning.",
    theme: "fear can be company",
    conflict: "stay-or-hide-from-thunder",
    emotionalArc: "fear-to-company",
    emotionalObjective: "Fear is named. It is not mocked and it is not magically deleted.",
    learningObjective: "A scary sound can be met slowly, with a trusted person, without pretending it is nothing.",
    learningKey: "sit-with-fear",
    value: "courage-with-company",
    beginning:
      "Clouds cover the terrace. {{name}} hears thunder and wants to run inside and shut every door. The fear is specific: {{fear}}.",
    middle:
      "On the veranda she counts, slowly, between the flash and the sound. The gap is long. The storm is not on the railing.",
    resolution: "She is still afraid and still there. She says so. Nobody tells her she is silly.",
    resolutionType: "named-fear-stays",
    culturalElement: "Monsoon afternoon on a barsati veranda, steel tumbler of water left on the ledge.",
    culturalSpecificity: "specific",
    humor: "none",
    adventure: "none",
    mystery: "where-is-the-storm",
    songUsage: "none",
    visualMotif: "lightning-then-count",
    developmentHook: "thunder",
    thin: false,
    settingKey: "veranda",
    wantsSupport: true,
    vocabulary: [
      { word: "गरज", meaning: "thunder", pronunciation: "ga-raj" },
      { word: "बरामदा", meaning: "veranda", pronunciation: "ba-raam-daa" },
      { word: "बिजली", meaning: "lightning", pronunciation: "bij-lee" },
    ],
    scenes: [
      {
        settingKey: "veranda",
        action: "{{nameHi}} wears {{clothing}}. Thunder rolls. She steps back. Fear: {{fear}}.",
        lines: [lead("", "", true), lead("मुझे डर लग रहा है।", "I am feeling scared.")],
      },
      {
        settingKey: "veranda",
        action: "A flash. She counts on her fingers before the sound arrives.",
        lines: [
          support("धीरे। एक, दो, तीन।", "Slowly. One, two, three."),
          lead("गरज अभी दूर है।", "The thunder is still far."),
        ],
      },
      {
        settingKey: "veranda",
        action: "Rain starts. She stays seated. The fear is smaller and still honest.",
        lines: [lead("डर लगा। मैं फिर भी यहाँ हूँ।", "I was scared. I am still here.")],
      },
    ],
  },
  {
    key: "scarf-on-the-line",
    storyStructure: "false-loss-then-look",
    title: "The Scarf on the Line",
    titleHi: "रस्सी पर दुपट्टा",
    logline: "A small scarf vanishes from the branch. It was never stolen. It is drying on the line.",
    theme: "look before you accuse",
    conflict: "missing-scarf",
    emotionalArc: "suspicion-to-relief",
    emotionalObjective: "The relief of being wrong about someone.",
    learningObjective: "Check the ordinary places before deciding someone took a thing.",
    learningKey: "look-first",
    value: "fairness",
    beginning: "{{name}} cannot find the little cloth that belongs with her friend. She is ready to say it was taken.",
    middle: "They search the pot, the step, the branch. The clothesline was behind the tulsi, lifting in the wind.",
    resolution: "The scarf is damp and safe. She says sorry for the fast guess.",
    resolutionType: "false-accusation-repaired",
    culturalElement: "A courtyard clothesline and a tulsi plant by the step.",
    culturalSpecificity: "specific",
    humor: "dramatic-search",
    adventure: "none",
    mystery: "where-is-the-scarf",
    songUsage: "none",
    visualMotif: "green-cloth-on-line",
    developmentHook: "honesty",
    thin: false,
    settingKey: "courtyard",
    wantsSupport: true,
    vocabulary: [
      { word: "रस्सी", meaning: "clothesline", pronunciation: "ras-see" },
      { word: "तुलसी", meaning: "tulsi plant", pronunciation: "tul-see" },
      { word: "गीला", meaning: "wet", pronunciation: "gee-laa" },
    ],
    scenes: [
      {
        settingKey: "courtyard",
        action: "{{nameHi}} in {{clothing}} stares at an empty branch. {{weakness}} wants an answer immediately.",
        lines: [lead("", "", true), lead("कपड़ा गायब है। किसी ने लिया?", "The cloth is gone. Did someone take it?")],
      },
      {
        settingKey: "courtyard",
        action: "They look past the tulsi. The scarf hangs on the line, flicking.",
        lines: [support("वहाँ। रस्सी पर।", "There. On the line."), lead("ओह। मैंने जल्दी बात कह दी।", "Oh. I spoke too fast.")],
      },
    ],
  },
  {
    key: "nimbu-pani",
    storyStructure: "one-thing-split",
    title: "Two Steel Glasses",
    titleHi: "दो स्टील के गिलास",
    logline: "One jug of nimbu pani, two thirsty people, and the first glass.",
    theme: "hot-day sharing",
    conflict: "first-glass",
    emotionalArc: "grab-to-split",
    emotionalObjective: "Sharing feels practical, not like a lecture.",
    learningObjective: "On a hot day, splitting the first glass is a real solution.",
    learningKey: "split-the-glass",
    value: "sharing",
    beginning: "The kitchen is hot. {{name}} hears the spoon in the jug and wants the first cold sip before anyone else.",
    middle: "There are two steel glasses and not enough ice. They pour half and half. Both glasses sweat.",
    resolution: "Neither glass is 'first'. Both are cold enough. The jug still has more.",
    resolutionType: "split-even",
    culturalElement: "Nimbu pani in steel glasses on a summer kitchen floor.",
    culturalSpecificity: "specific",
    humor: "both-reach",
    adventure: "none",
    mystery: "none",
    songUsage: "none",
    visualMotif: "two-sweating-glasses",
    developmentHook: "sharing",
    thin: false,
    settingKey: "kitchen",
    wantsSupport: true,
    vocabulary: [
      { word: "नींबू पानी", meaning: "lime water", pronunciation: "neem-boo paa-nee" },
      { word: "गिलास", meaning: "glass", pronunciation: "gi-laas" },
      { word: "ठंडा", meaning: "cold", pronunciation: "than-daa" },
    ],
    scenes: [
      {
        settingKey: "kitchen",
        action: "{{nameHi}} in {{clothing}} reaches for the jug. {{weakness}} is in the reach.",
        lines: [lead("", "", true), lead("पहला गिलास मेरा।", "The first glass is mine.")],
      },
      {
        settingKey: "kitchen",
        action: "Two glasses, one jug. She pours until they match.",
        lines: [
          support("आधा-आधा।", "Half and half."),
          lead("दोनों ठंडे हैं। पहला किसी एक का नहीं।", "Both are cold. First belongs to neither."),
        ],
      },
    ],
  },
  {
    key: "sabzi-list",
    storyStructure: "errand-versus-detour",
    title: "The Sabzi List",
    titleHi: "सब्ज़ी की पर्ची",
    logline: "A short market errand. A red balloon almost eats the coriander.",
    theme: "finish the small job",
    conflict: "errand-versus-balloon",
    emotionalArc: "distraction-to-return",
    emotionalObjective: "Coming back to a task feels like a win, not a scolding.",
    learningObjective: "A list can wait in the hand while you look, if you come back to it.",
    learningKey: "return-to-the-list",
    value: "responsibility",
    beginning: "{{name}} holds a short list: dhaniya, and nothing else. The lane has a red balloon.",
    middle: "She follows the balloon three stalls too far. The list is still in her fist, a little crushed.",
    resolution: "She buys the coriander, ties nothing to the balloon, and walks home with the green bunch.",
    resolutionType: "errand-finished",
    culturalElement: "A neighborhood sabzi stall and a paper list for dhaniya.",
    culturalSpecificity: "specific",
    humor: "balloon-detour",
    adventure: "three-stalls",
    mystery: "none",
    songUsage: "none",
    visualMotif: "red-balloon-green-bunch",
    developmentHook: "impatience",
    thin: false,
    settingKey: "lane",
    wantsSupport: false,
    vocabulary: [
      { word: "धनिया", meaning: "coriander", pronunciation: "dha-ni-yaa" },
      { word: "पर्ची", meaning: "small list", pronunciation: "pur-chee" },
      { word: "गुब्बारा", meaning: "balloon", pronunciation: "gub-baa-raa" },
    ],
    scenes: [
      {
        settingKey: "lane",
        action: "{{nameHi}} in {{clothing}} holds a folded list. A red balloon tugs her eyes. {{weakness}}.",
        lines: [lead("", "", true), lead("पहले गुब्बारा… नहीं। पहले धनिया।", "Balloon first… no. Coriander first.")],
      },
      {
        settingKey: "lane",
        action: "She buys the bunch. The balloon seller is still there. She waves and does not stop.",
        lines: [lead("पर्ची पूरी हुई।", "The list is done.")],
      },
    ],
  },
  {
    key: "paper-boat",
    storyStructure: "change-the-game",
    title: "The Paper Boat",
    titleHi: "कागज़ की नाव",
    logline: "Rain makes a lane-river. The boat can go. Her friend on the step cannot swim after it.",
    theme: "play that includes the one who stays",
    conflict: "boat-versus-friend-on-step",
    emotionalArc: "delight-to-inclusion",
    emotionalObjective: "Joy stays, and nobody is left as the audience.",
    learningObjective: "Change the game so the friend who cannot follow is still playing.",
    learningKey: "change-the-game",
    value: "friendship",
    beginning: "Rainwater runs along the lane. {{name}} folds a paper boat and wants to chase it to the drain.",
    middle: "Her friend stays on the dry step. Chasing would leave them behind. She brings the boat back uphill.",
    resolution: "They launch it together from the step and let it go without a chase.",
    resolutionType: "game-changed",
    culturalElement: "Monsoon lane water and a newspaper boat.",
    culturalSpecificity: "specific",
    humor: "boat-spins",
    adventure: "lane-river",
    mystery: "none",
    songUsage: "none",
    visualMotif: "newspaper-boat",
    developmentHook: "friendship",
    thin: false,
    settingKey: "lane",
    wantsSupport: true,
    vocabulary: [
      { word: "नाव", meaning: "boat", pronunciation: "naav" },
      { word: "बारिश", meaning: "rain", pronunciation: "baa-rish" },
      { word: "सीढ़ी", meaning: "step", pronunciation: "see-dhee" },
    ],
    scenes: [
      {
        settingKey: "lane",
        action: "{{nameHi}} in {{clothing}} sets a paper boat in the runoff. She wants to run after it.",
        lines: [lead("", "", true), lead("नाव भाग रही है!", "The boat is running away!")],
      },
      {
        settingKey: "lane",
        action: "Support stays on the step. She walks the boat back.",
        lines: [
          support("मैं सीढ़ी पर हूँ।", "I am on the step."),
          lead("फिर यहीं से छोड़ते हैं।", "Then we let it go from here."),
        ],
      },
    ],
  },
  {
    key: "quiet-morning",
    storyStructure: "notice-before-announce",
    title: "Before the Lane Wakes",
    titleHi: "गली जागे उससे पहले",
    logline: "She wakes before the milk booth. The quiet is interesting. Waking everyone would end it.",
    theme: "noticing",
    conflict: "keep-quiet-or-announce",
    emotionalArc: "excitement-to-keeping",
    emotionalObjective: "A private discovery can be enough.",
    learningObjective: "Some moments are for noticing, not for collecting an audience.",
    learningKey: "notice-first",
    value: "attention",
    beginning: "{{name}} wakes early. The lane is blue and empty. She wants to shake someone awake so they can see it too.",
    middle: "She does not. She watches the first bicycle, the crows, the rolled newspaper. She draws three small things.",
    resolution: "Later she shows the drawing. The quiet morning is already gone, and that is all right.",
    resolutionType: "kept-then-shared",
    culturalElement: "Early Indian lane: milk crate, newspaper roll, crows on a wire.",
    culturalSpecificity: "specific",
    humor: "none",
    adventure: "none",
    mystery: "none",
    songUsage: "none",
    visualMotif: "blue-lane-drawing",
    developmentHook: "curiosity",
    thin: false,
    settingKey: "lane",
    wantsSupport: false,
    vocabulary: [
      { word: "सुबह", meaning: "morning", pronunciation: "su-bah" },
      { word: "अखबार", meaning: "newspaper", pronunciation: "akh-baar" },
      { word: "कौआ", meaning: "crow", pronunciation: "kau-aa" },
    ],
    scenes: [
      {
        settingKey: "lane",
        action: "{{nameHi}} in {{clothing}} stands at the door. The lane is quiet. {{weakness}} wants to call everyone.",
        lines: [lead("", "", true), lead("अभी नहीं जगाऊँगी। पहले देखूँगी।", "I will not wake them yet. I will look first.")],
      },
      {
        settingKey: "kitchen",
        action: "She slides a drawing across the table later: bicycle, crow, newspaper.",
        lines: [lead("यह सुबह थी। अब खत्म हो गई।", "This was the morning. It is over now.")],
      },
    ],
  },
  {
    key: "lost-bangle",
    storyStructure: "found-object-returned",
    title: "One Steel Bangle",
    titleHi: "एक स्टील की चूड़ी",
    logline: "She finds a single steel bangle on the step and wants to keep the shine.",
    theme: "found things have people",
    conflict: "keep-or-return",
    emotionalArc: "want-to-return",
    emotionalObjective: "Returning something feels clean, not like a loss.",
    learningObjective: "A found object in the lane is still someone's.",
    learningKey: "return-found",
    value: "honesty",
    beginning: "{{name}} finds one steel bangle by the step. It fits her wrist almost. She wants it.",
    middle: "She asks at the next door, then the next. The third door knows the sound of that bangle.",
    resolution: "She gives it back. Her wrist is empty and she is not sorry.",
    resolutionType: "returned",
    culturalElement: "A steel bangle lost on a mohalla step.",
    culturalSpecificity: "specific",
    humor: "almost-fits",
    adventure: "door-to-door",
    mystery: "whose-bangle",
    songUsage: "none",
    visualMotif: "one-steel-bangle",
    developmentHook: "honesty",
    thin: false,
    settingKey: "lane",
    wantsSupport: false,
    vocabulary: [
      { word: "चूड़ी", meaning: "bangle", pronunciation: "choo-dee" },
      { word: "सीढ़ी", meaning: "step", pronunciation: "see-dhee" },
      { word: "वापस", meaning: "back / returned", pronunciation: "vaa-pas" },
    ],
    scenes: [
      {
        settingKey: "lane",
        action: "{{nameHi}} in {{clothing}} turns a steel bangle in her hand. It almost fits. {{weakness}} says keep it.",
        lines: [lead("", "", true), lead("यह किसकी है? मैं पूछूँगी।", "Whose is this? I will ask.")],
      },
      {
        settingKey: "lane",
        action: "A neighbor recognizes it. {{nameHi}} puts it in their palm.",
        lines: [lead("यह रही। मेरी नहीं थी।", "Here it is. It was not mine.")],
      },
    ],
  },
  {
    key: "holi-ask-first",
    storyStructure: "consent-before-play",
    title: "Ask Before the Color",
    titleHi: "रंग से पहले पूछो",
    logline: "Holi color is on her palm. She wants to press it on a friend. She asks first.",
    theme: "play needs a yes",
    conflict: "color-without-asking",
    emotionalArc: "impulse-to-asking",
    emotionalObjective: "A yes is more fun than a surprise smear.",
    learningObjective: "Festival play still needs consent, even with color that washes off.",
    learningKey: "ask-first",
    value: "respect",
    beginning: "There is a little dry pink color on {{name}}'s palm from the courtyard plate. Her friend is close.",
    middle: "She almost presses. She stops and asks. The friend looks, thinks, and offers one cheek, not the eye.",
    resolution: "One small mark. Both of them laugh. The rest of the color stays on the plate.",
    resolutionType: "asked-and-yes",
    culturalElement: "Holi color in a home courtyard. Play, not a religious claim.",
    culturalSpecificity: "specific",
    humor: "tiny-mark",
    adventure: "none",
    mystery: "none",
    songUsage: "motif",
    visualMotif: "pink-palm",
    developmentHook: "consent",
    thin: false,
    settingKey: "courtyard",
    wantsSupport: true,
    vocabulary: [
      { word: "होली", meaning: "Holi", pronunciation: "ho-lee" },
      { word: "रंग", meaning: "color", pronunciation: "rang" },
      { word: "पूछो", meaning: "ask", pronunciation: "poo-cho" },
    ],
    scenes: [
      {
        settingKey: "courtyard",
        action: "{{nameHi}} in {{clothing}} has pink color on one palm. She leans in, then stops. {{weakness}}.",
        lines: [lead("", "", true), lead("रंग लगाऊँ? हाँ बोलो, तब।", "May I put color? Say yes, then.")],
      },
      {
        settingKey: "courtyard",
        action: "The friend taps their own cheek. One fingerprint of pink. Nothing near the eye.",
        lines: [support("हाँ। बस गाल पर।", "Yes. Only on the cheek."), lead("हो गया। बस इतना।", "Done. Only that much.")],
      },
    ],
  },
  {
    key: "train-bridge",
    storyStructure: "stay-past-the-rush",
    title: "The Engine She Missed",
    titleHi: "जो इंजन छूट गया",
    logline: "From the lane bridge she wants the engine. She fidgets and misses it. The guard still waves.",
    theme: "the part after the hurry",
    conflict: "missed-the-engine",
    emotionalArc: "fidget-to-notice",
    emotionalObjective: "Disappointment without shame. There is still something to see.",
    learningObjective: "Rushing to the 'best part' can hide the rest of the thing.",
    learningKey: "stay-for-the-rest",
    value: "patience",
    beginning: "{{name}} stands on the footbridge at the end of the lane because a train is coming. She wants only the engine.",
    middle: "She turns to retie her ribbon. The engine passes. She is furious at the ribbon.",
    resolution: "The coaches keep coming. A guard at a door lifts a hand. She waves back. The missed engine stays missed.",
    resolutionType: "second-thing-counts",
    culturalElement: "A local train seen from a neighborhood footbridge.",
    culturalSpecificity: "specific",
    humor: "ribbon-blame",
    adventure: "train-pass",
    mystery: "none",
    songUsage: "none",
    visualMotif: "guard-wave",
    developmentHook: "impatience",
    thin: false,
    settingKey: "bridge",
    wantsSupport: false,
    vocabulary: [
      { word: "रेल", meaning: "train", pronunciation: "rail" },
      { word: "इंजन", meaning: "engine", pronunciation: "in-jan" },
      { word: "पुल", meaning: "bridge", pronunciation: "pul" },
    ],
    scenes: [
      {
        settingKey: "bridge",
        action: "{{nameHi}} in {{clothing}} leans on the footbridge rail. {{weakness}}. She fusses with her ribbon.",
        lines: [lead("", "", true), lead("इंजन निकल गया।", "The engine went past.")],
      },
      {
        settingKey: "bridge",
        action: "Coaches continue. A guard raises a hand. She raises hers.",
        lines: [lead("इंजन गया। हाथ अभी भी मिला।", "The engine went. The hand still happened.")],
      },
    ],
  },
  {
    key: "wrong-word",
    storyStructure: "two-words-kept",
    title: "The Wrong Word",
    titleHi: "गलत शब्द",
    logline: "She sings a home song with one funny wrong word. They keep the joke and learn the real word.",
    theme: "language play",
    conflict: "funny-word-versus-real-word",
    emotionalArc: "giggle-to-both-words",
    emotionalObjective: "Being wrong in a song is safe.",
    learningObjective: "A new Hindi word can arrive through play, not correction-as-punishment.",
    learningKey: "keep-both-words",
    value: "curiosity",
    beginning: "{{name}} sings the evening song and lands on a word that is not the word. It sounds like a snack.",
    middle: "Everyone laughs once. Then the real word is said slowly, and she tries it without losing the joke.",
    resolution: "She sings the line twice: the real word, then the snack-word, then stops. The song is intact.",
    resolutionType: "word-kept",
    culturalElement: "An evening home song, not a copied film lyric.",
    culturalSpecificity: "specific",
    humor: "snack-word",
    adventure: "none",
    mystery: "none",
    songUsage: "motif",
    visualMotif: "two-words-on-fingers",
    developmentHook: "curiosity",
    thin: false,
    settingKey: "veranda",
    wantsSupport: true,
    vocabulary: [
      { word: "शब्द", meaning: "word", pronunciation: "shabd" },
      { word: "गाना", meaning: "song", pronunciation: "gaa-naa" },
      { word: "धीरे", meaning: "slowly", pronunciation: "dhee-re" },
    ],
    scenes: [
      {
        settingKey: "veranda",
        action: "{{nameHi}} in {{clothing}} sings one line and swaps a word for a silly one.",
        lines: [lead("", "", true), lead("यह शब्द मज़ेदार है। असली वाला क्या है?", "This word is funny. What is the real one?")],
      },
      {
        settingKey: "veranda",
        action: "The real word is said once, slowly. She repeats it, then smiles at the joke word.",
        lines: [support("धीरे बोलो। असली शब्द यही है।", "Say it slowly. This is the real word."), lead("दोनों याद रहेंगे। गाना असली शब्द से।", "I will remember both. The song uses the real word.")],
      },
    ],
  },
  {
    key: "one-swing",
    storyStructure: "counted-turn",
    title: "One Swing",
    titleHi: "एक झूला",
    logline: "The lane has one swing. Two children. The rope does not multiply.",
    theme: "turns",
    conflict: "one-swing",
    emotionalArc: "hold-on-to-turn",
    emotionalObjective: "Waiting is visible and short, so it feels fair.",
    learningObjective: "A turn can be counted out loud so nobody has to guess.",
    learningKey: "count-the-turn",
    value: "fairness",
    beginning: "{{name}} is on the only swing. Someone is waiting and she does not want to stop while it still feels good.",
    middle: "They count ten swings out loud. At ten her feet drag the dust and she gets off without a speech.",
    resolution: "She waits. The count works in the other direction too.",
    resolutionType: "counted-turn",
    culturalElement: "A single rope swing from a lane tree.",
    culturalSpecificity: "specific",
    humor: "loud-counting",
    adventure: "none",
    mystery: "none",
    songUsage: "none",
    visualMotif: "rope-swing-dust",
    developmentHook: "sharing",
    thin: false,
    settingKey: "lane",
    wantsSupport: true,
    vocabulary: [
      { word: "झूला", meaning: "swing", pronunciation: "jhoo-laa" },
      { word: "बारी", meaning: "turn", pronunciation: "baa-ree" },
      { word: "दस", meaning: "ten", pronunciation: "das" },
    ],
    scenes: [
      {
        settingKey: "lane",
        action: "{{nameHi}} in {{clothing}} swings and sees someone waiting. {{weakness}} says keep going.",
        lines: [lead("", "", true), lead("दस झूले। फिर बारी बदलेंगे।", "Ten swings. Then the turn changes.")],
      },
      {
        settingKey: "lane",
        action: "She drags her feet at ten and steps off.",
        lines: [support("अब मेरी दस।", "Now my ten."), lead("गिनना दोनों के लिए है।", "The counting is for both.")],
      },
    ],
  },
];

export const THIN_BLUEPRINT: StoryBlueprint = {
  key: "just-walks",
  storyStructure: "no-structure",
  title: "A Walk",
  titleHi: "एक चलना",
  logline: "She walks.",
  theme: "generic",
  conflict: "",
  emotionalArc: "none",
  emotionalObjective: "",
  learningObjective: "",
  learningKey: "",
  value: "",
  beginning: "{{name}} walks in a place.",
  middle: "",
  resolution: "",
  resolutionType: "",
  culturalElement: "",
  culturalSpecificity: "none",
  humor: "none",
  adventure: "none",
  mystery: "none",
  songUsage: "none",
  visualMotif: "",
  developmentHook: null,
  thin: true,
  settingKey: "lane",
  wantsSupport: false,
  vocabulary: [],
  scenes: [
    {
      settingKey: "lane",
      action: "{{name}} walks.",
      lines: [lead("चलते हैं।", "We walk.")],
    },
  ],
};

export function blueprintByKey(key: string): StoryBlueprint | undefined {
  if (key === THIN_BLUEPRINT.key) return THIN_BLUEPRINT;
  return BLUEPRINTS.find((item) => item.key === key);
}

export function strongBlueprints(): StoryBlueprint[] {
  return BLUEPRINTS.filter((item) => !item.thin);
}
