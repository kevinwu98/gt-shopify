import {Link} from 'react-router';
import {Image} from '@shopify/hydrogen';
import type {
  ProductItemFragment,
  CollectionItemFragment,
  RecommendedProductFragment,
} from 'storefrontapi.generated';
import {useVariantUrl} from '~/lib/variants';
import {useCatalog} from '~/lib/useCatalog';
import {LocalizedMoney} from './LocalizedMoney';

export function ProductItem({
  product,
  loading,
}: {
  product:
    CollectionItemFragment | ProductItemFragment | RecommendedProductFragment;
  loading?: 'eager' | 'lazy';
}) {
  const catalog = useCatalog();
  const title = catalog(product.id, 'title', product.title);
  const variantUrl = useVariantUrl(product.handle);
  const image = product.featuredImage;
  return (
    <Link
      className="product-item"
      key={product.id}
      prefetch="intent"
      to={variantUrl}
    >
      {image && (
        <Image
          alt={image.altText || title}
          aspectRatio="1/1"
          data={image}
          loading={loading}
          sizes="(min-width: 45em) 400px, 100vw"
        />
      )}
      <h4>{title}</h4>
      <small>
        <LocalizedMoney data={product.priceRange.minVariantPrice} />
      </small>
    </Link>
  );
}
