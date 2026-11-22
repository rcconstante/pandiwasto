/** The PandiWasto mascot and wordmark. Wrap it in a link or button with the "pw-brand" class. */
export function BrandLogo({ tagline = false }: { tagline?: boolean }) {
  return (
    <>
      <img src={`${import.meta.env.BASE_URL}pandiwasto-mascot.webp`} alt="" width="48" height="48" />
      <span className="pw-brand-word">
        Pandi<span>Wasto</span>
        {tagline && <small>Filipino Learning</small>}
      </span>
    </>
  );
}
