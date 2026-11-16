import { useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { account, ApiError } from '../services/api';

// The server only ever sees a square JPEG at this size. Doing the crop in the
// browser keeps the upload far under Vercel's 4.5MB body limit and means the
// originals never leave the device - a 12MP phone photo becomes ~150KB here.
const OUTPUT_SIZE = 512;
const JPEG_QUALITY = 0.9;

const UPLOAD_ERRORS = {
  'storage-not-configured': 'Photo storage is not set up on this deployment yet.',
  'too-large': 'That image is too large. Try a smaller one.',
  'invalid-type': 'Choose a JPEG, PNG or WebP image.',
  'no-file': 'Choose an image first.',
  'invalid-upload': 'That upload could not be read. Try another image.'
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image-load'));
    image.src = src;
  });
}

// Draw the part inside the crop frame onto a fixed square canvas. A white
// backdrop matters: a transparent PNG encoded as JPEG would otherwise turn
// black wherever nothing was painted.
async function cropToBlob(image, area) {
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const sx = Math.max(0, Math.round(area.x));
  const sy = Math.max(0, Math.round(area.y));
  const sw = Math.max(1, Math.min(image.naturalWidth - sx, Math.round(area.width)));
  const sh = Math.max(1, Math.min(image.naturalHeight - sy, Math.round(area.height)));
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode'))), 'image/jpeg', JPEG_QUALITY);
  });
}

export default function AvatarUploader({ file, onCancel, onUploaded }) {
  const [imageUrl, setImageUrl] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const imageRef = useRef(null);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    setError('');

    let cancelled = false;
    loadImage(url)
      .then((image) => { if (!cancelled) imageRef.current = image; })
      .catch(() => { if (!cancelled) setError('That image could not be opened. Try another.'); });

    return () => {
      cancelled = true;
      imageRef.current = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape' && !saving) onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel, saving]);

  async function save() {
    if (saving || !area || !imageUrl) return;
    setSaving(true);
    setError('');
    try {
      const image = imageRef.current || await loadImage(imageUrl);
      const blob = await cropToBlob(image, area);
      const data = await account.uploadAvatar(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      onUploaded(data.avatarUrl);
    } catch (err) {
      const code = err instanceof ApiError ? err.body?.error : null;
      setError(UPLOAD_ERRORS[code] || 'Could not upload the photo. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}
    >
      <div className="confirm-card avatar-crop-card" role="dialog" aria-modal="true" aria-label="Crop profile photo">
        <h3 className="confirm-title">Crop your photo</h3>
        <p className="confirm-message">
          Drag to move the photo, and use the slider to zoom. The circle is how it
          will appear across the app.
        </p>

        <div className="avatar-crop-stage">
          {imageUrl && (
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
            />
          )}
        </div>

        <label className="avatar-crop-zoom">
          <span className="material-symbols-rounded" aria-hidden="true">zoom_out</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            aria-label="Zoom"
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <span className="material-symbols-rounded" aria-hidden="true">zoom_in</span>
        </label>

        {error && (
          <p className="confirm-message" role="alert" style={{ color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}

        <div className="confirm-actions">
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !area || !imageUrl}>
            {saving ? 'Uploading…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
