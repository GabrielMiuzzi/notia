interface ImageViewProps {
  imageUrl: string
  alt: string
}

export function ImageView({ imageUrl, alt }: ImageViewProps) {
  return (
    <div className="notia-image-view">
      <img src={imageUrl} alt={alt} className="notia-image-preview" />
    </div>
  )
}
