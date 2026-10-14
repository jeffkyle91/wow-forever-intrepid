export function ArtIcon({ src, className }: { src: string; className: string }) {
  return <img className={className} src={src} alt="" aria-hidden="true" />
}
