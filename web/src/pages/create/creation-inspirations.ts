import { curatedInspirations, inspirationSources, type CreationInspiration } from "@/lib/inspirations/catalog";

/** Compatibility exports for the original creation page inspiration contract. */
export const creationFeaturedWorks = curatedInspirations.map(({ sourceId, credit, ...item }) => ({
    ...item,
    ...(sourceId === "chatgpt-prompts" && credit ? { source: credit } : {}),
}));

export const englishCreationFeaturedWorks: CreationInspiration[] = [
    { title: "Neon after rain", description: "A cinematic opening with slow camera movement", image: "/short-drama-styles/cyberpunk-neon.jpg", mode: "video", featured: true, prompt: "A rain-soaked city street at night. Neon signs reflect across wet pavement as the protagonist walks through a crowd under an umbrella. Slowly push from a wide shot to a close-up profile. Cinematic lighting, 16:9." },
    { title: "Rooftop reunion", description: "Restrained emotion in a vintage city scene", image: "/short-drama-styles/retro-hong-kong.jpg", mode: "video", prompt: "A 1990s Hong Kong rooftop at sunset. Two old friends face each other across a clothesline after years apart. Wind moves their coats. Subtle handheld camera slowly approaches." },
    { title: "Noir pursuit", description: "High contrast shadows and rising tension", image: "/short-drama-styles/suspense-noir.jpg", mode: "video", prompt: "Black-and-white mystery film. A detective chases a mysterious figure through a narrow alley. Streetlights cut through the darkness. Track low to the ground as the pace builds." },
    { title: "Fantasy character design", description: "A detailed cinematic character concept", image: "/short-drama-styles/fantasy-3d.jpg", mode: "image", prompt: "Character concept art of a young swordswoman in an original eastern fantasy world, with silver hair ornaments, layered light armor and a red cape. Mountain mist in the background. Detailed materials and cinematic concept-art lighting." },
    { title: "An inverted room", description: "Surreal space with soft light", image: "/short-drama-styles/surreal-dream.jpg", mode: "image", prompt: "A surreal film concept image of an upside-down bedroom floating above clouds. The bed and desk hang from the ceiling, and an open door leads to a pale pink sky. Soft diffused light, precise perspective, detailed materials, no people or text." },
    { title: "A quiet farewell", description: "Write a scene through action and subtext", image: "/welcome/wing-it/barn.webp", mode: "text", prompt: "Write a short scene between a mother and daughter in a warmly lit living room. The daughter is about to leave her hometown. The mother appears calm but keeps sorting through old belongings. Build the emotion through physical actions and subtext, without stating their feelings directly." },
    { title: "The last bus", description: "A short drama with a single location", image: "/short-drama-styles/urban-live-action.jpg", mode: "text", credit: "Screenwriter", prompt: "Write a three-minute short drama set on the last bus of the night. Two strangers each claim to have lost a notebook, but only one is telling the truth. Define their motives and secrets, then write the action, dialogue, and final reversal. Use two characters and one location." },
];

export const inspirationSource = inspirationSources["chatgpt-prompts"];
