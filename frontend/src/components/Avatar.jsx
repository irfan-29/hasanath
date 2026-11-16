// One circular avatar for the whole app: the stored photo when there is one,
// the account's initial otherwise. Sharing the component keeps the image rules
// (cover, round, lazy) identical in the navbar, account page, profile and post
// bylines instead of each call site growing its own <img> branch.
export default function Avatar({ src, name, className = '', alt = '' }) {
  const initial = (name || '?').charAt(0).toUpperCase();
  return (
    <span className={className} aria-hidden={alt ? undefined : 'true'}>
      {src ? (
        <img
          className="avatar-img"
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : initial}
    </span>
  );
}
