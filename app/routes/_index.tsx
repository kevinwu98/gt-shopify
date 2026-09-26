import {Suspense} from 'react';
import {Await, useLoaderData, useRouteLoaderData, Link} from 'react-router';
import {Image} from '@shopify/hydrogen';

import type {Route} from './+types/_index';
import type {
  FeaturedCollectionFragment,
  RecommendedProductsQuery,
} from 'storefrontapi.generated';
import {ProductItem} from '~/components/ProductItem';
import {MockShopNotice} from '~/components/MockShopNotice';
import {T, Var, useGT} from 'gt-react';
import {useCatalog} from '~/lib/useCatalog';

import type {RootLoader} from '~/root';

export const meta: Route.MetaFunction = () => [{title: 'Great Things'}];

export async function loader(args: Route.LoaderArgs) {
  const deferredData = loadDeferredData(args);
  const criticalData = await loadCriticalData(args);
  return {...deferredData, ...criticalData};
}

async function loadCriticalData({context}: Route.LoaderArgs) {
  const {collections, featuredProduct} = await context.storefront.query(
    FEATURED_COLLECTION_QUERY,
  );
  return {featuredCollection: collections.nodes[0] ?? null, featuredProduct};
}

function loadDeferredData({context}: Route.LoaderArgs) {
  const recommendedProducts = context.storefront
    .query(RECOMMENDED_PRODUCTS_QUERY)
    .catch((error: Error) => {
      console.error(error);
      return null;
    });
  return {recommendedProducts};
}

export default function Homepage() {
  const data = useLoaderData<typeof loader>();
  const rootData = useRouteLoaderData<RootLoader>('root');
  return (
    <div className="home">
      {rootData?.isDemoStore ? <MockShopNotice /> : null}
      <FeaturedCollection
        collection={data.featuredCollection}
        product={data.featuredProduct}
      />
      <RecommendedProducts products={data.recommendedProducts} />
    </div>
  );
}

function FeaturedCollection({
  collection,
  product,
}: {
  collection: FeaturedCollectionFragment | null;
  product: Awaited<ReturnType<typeof loadCriticalData>>['featuredProduct'];
}) {
  const catalog = useCatalog();
  const gt = useGT();
  const image =
    product?.featuredImage ??
    collection?.image ??
    collection?.products.nodes[0]?.featuredImage;
  const title = product
    ? catalog(product.id, 'title', product.title)
    : (collection?.title ?? '');
  const destination = product
    ? `/products/${product.handle}`
    : '/collections/all';
  return (
    <section className="store-hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <T context="Great Things is the store name. Translate its meaning into the target language rather than leaving it in English.">
          <h1 id="hero-title">Great Things</h1>
          <p className="hero-description">
            by <Var>General Translation</Var>
          </p>
        </T>
        <Link className="button-primary" to="/collections/all" prefetch="intent">
          {gt('Explore the collection', {$format: 'STRING'})}<span aria-hidden="true">↗</span>
        </Link>
      </div>
      <div className="hero-image">
        {image ? (
          <Image
            data={image}
            sizes="(min-width: 600px) 50vw, 100vw"
            alt={title}
            loading="eager"
          />
        ) : null}
        {image ? (
          <Link className="hero-collection-link" to={destination}>
            <span>{title}</span>
            <span aria-hidden="true">↗</span>
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function RecommendedProducts({
  products,
}: {
  products: Promise<RecommendedProductsQuery | null>;
}) {
  return (
    <section
      className="recommended-products"
      aria-labelledby="recommended-products"
    >
      <T>
        <div className="section-heading">
          <h2 id="recommended-products">Designed for everywhere you will go</h2>
          <Link className="text-link" to={'/collections/all'}>
            Shop all<span aria-hidden="true">↗</span>
          </Link>
        </div>
      </T>
      <Suspense
        fallback={
          <T>
            <div className="products-loading">Finding your next favorites…</div>
          </T>
        }
      >
        <Await resolve={products}>
          {(response) =>
            response ? (
              <div className="recommended-products-grid">
                {response.products.nodes.map((product) => (
                  <ProductItem key={product.id} product={product} />
                ))}
              </div>
            ) : (
              <T>
                <p>We could not load the collection. Please try again.</p>
              </T>
            )
          }
        </Await>
      </Suspense>
    </section>
  );
}

const FEATURED_COLLECTION_QUERY = `#graphql
  fragment FeaturedCollection on Collection {
    id
    title
    image {
      id
      url
      altText
      width
      height
    }
    products(first: 1) {
      nodes {
        featuredImage {
          id
          url
          altText
          width
          height
        }
      }
    }
    handle
  }
  query FeaturedCollection($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    featuredProduct: product(handle: "soft-cotton-hoodie-in-ocean") {
      id title handle
      featuredImage { id url altText width height }
    }
    collections(first: 1, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ...FeaturedCollection
      }
    }
  }
` as const;

const RECOMMENDED_PRODUCTS_QUERY = `#graphql
  fragment RecommendedProduct on Product {
    id
    title
    handle
    priceRange {
      minVariantPrice {
        amount
        currencyCode
      }
    }
    featuredImage {
      id
      url
      altText
      width
      height
    }
  }
  query RecommendedProducts ($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
    products(first: 8, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ...RecommendedProduct
      }
    }
  }
` as const;
