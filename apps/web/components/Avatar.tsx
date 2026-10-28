/** Photo de profil (URL signée temporaire) ou initiale. */
export function Avatar({ name, url, size = 'h-12 w-12' }: { name: string; url: string | null; size?: string }) {
  if (url) {
    // URL signée temporaire du stockage privé : pas d'optimisation d'image Next.js.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={`${size} rounded-full object-cover`} />;
  }
  return (
    <span aria-hidden="true" className={`${size} inline-flex items-center justify-center rounded-full bg-brand-soft font-semibold text-brand-strong`}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
