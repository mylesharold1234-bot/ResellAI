import { Camera } from "lucide-react";
export function ProductImage({
  photo,
  alt = "Uploaded product photo",
  small = false,
}: {
  photo?: string;
  alt?: string;
  small?: boolean;
}) {
  return (
    <div className={`shoe-stage product-image ${small ? "compact" : ""}`}>
      {photo ? (
        <img src={photo} alt={alt} />
      ) : (
        <div className="photo-placeholder">
          <Camera size={34} />
          <span>Product photo unavailable</span>
        </div>
      )}
    </div>
  );
}
