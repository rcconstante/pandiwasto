// Single source for lesson text. The Lessons tab and the server hint ladder both read it,
// so a reviewed correction reaches learners and hints together.
export const LESSONS = [
  { id: "salitang-ugat", title: "Salitang-Ugat", gloss: "Root words", explanation: "Ang salitang-ugat ang payak na anyo ng isang salita. Subukang hanapin ang ugat bago idagdag ang mga panlapi.", example: "sumulat → sulat", gameId: 1 },
  { id: "kayarian-ng-salita", title: "Kayarian ng Salita", gloss: "Word structure", explanation: "May apat na kayarian ng salita. Ang payak ay salitang-ugat, ang maylapi ay may panlapi, ang tambalan ay binubuo ng dalawang salita, at ang inuulit ay may pag-uulit ng buong salita o bahagi nito.", example: "bata (payak) · sumulat (maylapi) · bahay-kubo (tambalan) · araw-araw (inuulit)", gameId: 2 },
  { id: "unlapi", title: "Unlapi", gloss: "Prefixes", explanation: "Ang unlapi ay inilalagay sa unahan ng salitang-ugat.", example: "mag- + laro → maglaro", gameId: 3 },
  { id: "gitlapi", title: "Gitlapi", gloss: "Infixes", explanation: "Ang gitlapi ay isinisingit sa loob ng salitang-ugat.", example: "sulat + -um- → sumulat", gameId: 3 },
  { id: "hulapi", title: "Hulapi", gloss: "Suffixes", explanation: "Ang hulapi ay idinadagdag sa dulo ng salitang-ugat.", example: "basa + -hin → basahin", gameId: 3 },
  { id: "kabilaan", title: "Kabilaan / Laguhan", gloss: "Circumfixes", explanation: "Sa kabilaan, may panlapi sa unahan at hulihan ng salitang-ugat. Sa laguhan, mayroon ding gitlapi.", example: "pag- + aral + -an → pag-aralan", gameId: 3 },
  { id: "tambalan", title: "Tambalan", gloss: "Compound words", explanation: "Nabubuo ang tambalang salita kapag pinagsama ang dalawang salita upang makabuo ng isang kahulugan.", example: "bahay + kubo → bahay-kubo", gameId: 4 },
  { id: "pag-uulit", title: "Pag-uulit", gloss: "Reduplication", explanation: "Sa ganap na pag-uulit, inuulit ang buong salita. Sa parsiyal na pag-uulit, bahagi lamang ng salita ang inuulit.", example: "gabi + gabi → gabi-gabi · su + sulat → susulat", gameId: 5 },
  { id: "pokus-ng-pandiwa", title: "Pokus ng Pandiwa", gloss: "Verb focus", explanation: "Ipinapakita ng pokus ang papel ng paksa sa kilos. Ang tagaganap ang gumagawa ng kilos. Ang layon ang tinutukoy ng kilos. Ang ganapan ang lugar ng kilos. Ang tagatanggap ang pinaglalaanan ng kilos.", example: "Nagluto si Ana. → Pokus sa tagaganap", gameId: 6 },
  { id: "asimilasyon", title: "Asimilasyon", gloss: "Sound changes", explanation: "Maaaring magbago ang huling tunog ng pang- depende sa unang tunog ng salitang-ugat. Maaaring maging pam- o pan-, o manatiling pang-.", example: "pang- + bansa → pambansa · pang- + linis → panlinis · pang- + gupit → panggupit", gameId: 7 },
] as const;
