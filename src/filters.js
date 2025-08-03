// filters.js
// Game filter functions for Betfred extension

export function isChristmasGame(title) {
  return /christmas|Scrooge|saint nicked|carol|xmas|yule|santa|festive|holiday|jingle|winter/i.test(title || "");
}

export function isHalloweenGame(title) {
  return /\b(halloween|devil|horror|spooky|ghost|pumpkin|witch|zombie|monster|vampire|fright|haunt|boo|scream|skeleton|werewolf|666|frankenstein|apparition|haunted|scary|grim reaper|creepy|trick or treat|terror|demon)\b/i.test(title || "") ||
         title.toLowerCase() === 'blood suckers' ||
         title.toLowerCase() === 'blood suckers megaways' ||
         title.toLowerCase() === 'blood lust' ||
         title.toLowerCase() === 'blood moon hold & win' ||
         title.toLowerCase() === 'blood moon wilds' ||
         title.toLowerCase() === 'bloodthirst' ||
         title.toLowerCase() === 'day of dead' ||
         title.toLowerCase() === 'demon' ||
         title.toLowerCase() === 'blade & fangs' ||
         title.toLowerCase() === 'fangtastic freespins' ||
         title.toLowerCase() === 'fear the dark' ||
         title.toLowerCase() === 'zombie carnival' ||
         title.toLowerCase() === 'granny vs zombies' ||
         title.toLowerCase() === 'immortal desire' ||
         title.toLowerCase() === 'six six six' ||
         title.toLowerCase() === 'skeleton key' ||
         title.toLowerCase() === 'vampy party';
}

export function isEasterGame(title) {
  return /\b(easter|bunny|egg|rabbit|chick|spring|pastel|basket|chocolate)\b/i.test(title || "");
}

export function isRomanceGame(title) {
  return /\b(valentine|valentines|love|romance|heart|cupid|kiss|sweet|darling|honey|rose|roses|cherry|cherries|strawberry|strawberries|pink|romantic|passion|desire|affection|adore|beloved|sweetheart)\b/i.test(title || "") ||
         title.toLowerCase() === 'burn in love' ||
         title.toLowerCase() === 'immortal romance' ||
         title.toLowerCase() === 'immortal romance ii' ||
         title.toLowerCase() === 'immortal romance mega moolah' ||
         title.toLowerCase() === 'immortal romance vein of gold' ||
         title.toLowerCase() === 'irish love' ||
         title.toLowerCase() === 'lucky valentine' ||
         title.toLowerCase() === 'stacked valentine hearts' ||
         title.toLowerCase() === 'sweet bonanza' ||
         title.toLowerCase() === 'sweet bonanza 1000' ||
         title.toLowerCase() === 'sweet bonanza super scatter' ||
         title.toLowerCase() === 'sweet bonanza xmas' ||
         title.toLowerCase() === 'sweet candy cash' ||
         title.toLowerCase() === 'sweet candy cash megaways' ||
         title.toLowerCase() === 'sweet candy cash megaways deluxe' ||
         title.toLowerCase() === 'sweet candy christmas' ||
         title.toLowerCase() === 'sweet kingdom' ||
         title.toLowerCase() === 'sweet beast power combo' ||
         title.toLowerCase() === 'sweet candy cash' ||
         title.toLowerCase() === 'sweet n juicy' ||
         title.toLowerCase() === 'true love' ||
         title.toLowerCase() === 'lovefool' ||
         title.toLowerCase() === 'heart of the frontier' ||
         title.toLowerCase() === 'heart of cleopatra' ||
         title.toLowerCase() === '2 sweet 4 u';
}

export function isSportGame(title) {
  return /\b(football|soccer|9 Races to Glory|Rainbow Riches Race Day|Big Bass Day at the Races|Big Bass Return to the Races|baseball|basketball|tennis|golf|olympics|race|hockey|sporting|snooker|sport)\b/i.test(title || "");
}

export function isBlackjackGame(title) {
  return /blackjack|perfect pairs/i.test(title || "");
}

export function isFishingGame(title) {
  return /\b(fish|fishing|bass|trout|salmon|tuna|carp|pike|perch|catfish|angler|fisher|hook|rod|bait|lure|catch|swim|ocean|sea|river|lake|pond|stream|water|aquatic|marine|underwater|deep|dive|submarine|shark|whale|dolphin|octopus|squid|crab|lobster|clam|oyster|pearl|coral|reef|boat|sail|anchor|net|harpoon|spear|feeding|oxygen|kraken|big bass|bigbass)\b/i.test(title || "") ||
         title.toLowerCase() === 'feeding fury' ||
         title.toLowerCase() === 'oxygen' ||
         title.toLowerCase() === 'oxygen 2' ||
         title.toLowerCase() === 'release the kraken' ||
         title.toLowerCase() === 'release the kraken 2' ||
         title.toLowerCase() === 'wild link frenzy';
}

export const tvAndMovieSlots = [
  "The Goonies", "Ted", "Beavis & Butthead", "Rocky", "Gladiator", "Ace Ventura", "Top Gun",
  "Anaconda Wild", "Terminator 2", "Jurassic Park", "Lara Croft", "Jumanji", "Creature from the Black Lagoon",
  "The Mask", "Batman", "The Dark Knight", "Superman", "Man of Steel", "Justice League", "Wonder Woman",
  "Robocop", "The Matrix", "Dirty Dancing", "Grease", "The Flintstones", "The Mummy", "Pink Panther",
  "Space Invaders", "Godzilla vs Kong", "Rambo", "The Expendables", "Platoon", "Basic Instinct",
  "Paranormal Activity", "Bridesmaids", "Jurassic World", "Highlander", "Game of Thrones",
  "The Phantom of the Opera", "Tarzan", "Jaws",
  "Peaky Blinders", "Narcos", "Narcos Mexico", "Knight Rider",
  "Rick & Morty", "Rick and Morty", "Joe Exotic", "Baywatch", "Downton Abbey",
  "Ted", "The Love Boat", "The Sopranos", "The X-Files", "The Six Million Dollar Man", "WWE Bonus Rumble Gold Blitz",
  "WWE Clash of the Wilds", "WWE Legends: Link & Win",
  "World of Wonka", "Ghostbusters", "Top Cat", "Lara Croft Tomb Raider", "Aladdin and the Sorcerer",
  "Lara Croft Temples and Tombs", "Jungle Books", "Hercules & Pegasus", "Gremlins", "Beetlejuice Megaways",
  "Phantom of the Opera Link & Win", "Squid Game One Lucky Day", "Dungeons & Dragons Power Combo", "Dumb and Dumber Route To Riches",
  "Gordon Ramsay Hell's Kitchen", "The Terminator Win And Spin", "Squid Game Gganbu", "Kong's Temple", "Kong Wonder Wilds",
  "Breaking Bad", "Deadliest Catch", "Gold Rush Cash Collect", "Gold Rush Cash Collect Scratch", 
  "Gladiator Jackpot", "The Walking Dead", "Torrente", "Robin Hood",
  "Deal or No Deal", "Who Wants to Be a Millionaire", "Millionaire Rush", "The X Factor",
  "Britain's Got Talent", "The Voice UK", "Family Fortunes", "Wheel of Fortune", "The 100,000 Pyramid"
];

export function isTVAndMovie(title) {
  const normTitle = title.trim().toLowerCase();
  return tvAndMovieSlots.some(slot => {
    const slotLower = slot.trim().toLowerCase();
    // Use word boundary matching to avoid partial matches
    const regex = new RegExp(`^${slotLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return regex.test(normTitle);
  });
}

export function isMegawaysGame(title) {
  return /megaways/i.test(title || "");
} 