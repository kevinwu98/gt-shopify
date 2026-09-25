import type {ProductVariantFragment} from 'storefrontapi.generated';
import {Image} from '@shopify/hydrogen';
import {useGT} from 'gt-react';

export function ProductImage({
  image,
}: {
  image: ProductVariantFragment['image'];
}) {
  const gt = useGT();

  if (!image) {
    return <div className="product-image" />;
  }
  return (
    <div className="product-image">
      <Image
        alt={image.altText || gt('Product image')}
        aspectRatio="1/1"
        data={image}
        key={image.id}
        sizes="(min-width: 45em) 50vw, 100vw"
      />
    </div>
  );
}
