import StickerSlapFooter from "@/components/ui/sticker-slap-footer";

export function Footer() {
  return (
    <StickerSlapFooter
      wordmark="PandiWasto"
      homeHref="#home"
      navLabel=""
      navHref="#home"
      chatHref=""
      jobsLabel="Explore"
      jobs={[
        { title: "Arcade games", href: "#games" },
        { title: "BKT & hints", href: "#bkt-engine" },
        { title: "FAQ", href: "#faq" },
      ]}
      officeLabel="PandiWasto"
      address={["A Filipino morphology arcade", "Seven games for building word skills"]}
      mapLabel=""
      mapHref=""
      email=""
      note=""
      socials={[]}
      credits={[]}
      stickers={[
        { kind: "burst", text: "TARA!", label: "Tara sticker", x: 19, y: 43 },
        { kind: "daisy", x: 53, y: 55 },
        { kind: "bolt", x: 78, y: 50 },
      ]}
      height="auto"
      wordmarkMaxHeight="310px"
      paper="#fcf9ef"
      panel="#244d39"
      accent="#d7ff8d"
    >
      <nav className="pw-footer-links" aria-label="Site policies">
        <a href="#terms">Terms and Conditions</a>
        <a href="#privacy">Privacy Notice</a>
        <a href="#cookies">Cookies</a>
      </nav>
    </StickerSlapFooter>
  );
}
