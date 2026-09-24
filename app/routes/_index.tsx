import {Suspense} from 'react';
import {Await, useLoaderData, useRouteLoaderData, Link} from 'react-router';
import {Image} from '@shopify/hydrogen';
import {T} from 'gt-react';
import type {Route} from './+types/_index';
import type {
  FeaturedCollectionFragment,
  RecommendedProductsQuery,
} from 'storefrontapi.generated';
import {ProductItem} from '~/components/ProductItem';
import {MockShopNotice} from '~/components/MockShopNotice';
import {useLocalePath} from '~/lib/i18n';
import type {RootLoader} from '~/root';

export const meta: Route.MetaFunction = () => [{title: 'GT Supply'}];

export async function loader(args: Route.LoaderArgs) {
  const deferredData = loadDeferredData(args);
  const criticalData = await loadCriticalData(args);
  return {...deferredData, ...criticalData};
}

async function loadCriticalData({context}: Route.LoaderArgs) {
  const {collections} = await context.storefront.query(FEATURED_COLLECTION_QUERY);
  return {featuredCollection: collections.nodes[0]};
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
      <FeaturedCollection collection={data.featuredCollection} />
      <RecommendedProducts products={data.recommendedProducts} />
      <section className="everyday-note">
        <p className="eyebrow"><T>Less fuss. More living.</T></p>
        <h2><T>Find your everyday.</T></h2>
        <p><T>Simple pieces that make getting dressed feel effortless.</T></p>
      </section>
    </div>
  );
}

function FeaturedCollection({collection}: {collection: FeaturedCollectionFragment}) {
  const localePath = useLocalePath();
  const image = collection?.image;
  return (
    <section className="store-hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow"><T>Everyday essentials</T></p>
        <h1 id="hero-title"><T>Good things,<br />worn often.</T></h1>
        <p className="hero-description"><T>Easy layers. Familiar favorites. Find your everyday uniform.</T></p>
        <Link className="button-primary" to={localePath('/collections/all')} prefetch="intent">
          <T>Explore the collection</T><span aria-hidden="true">↗</span>
        </Link>
        <p className="hero-footnote"><T>Your next favorite is right here.</T></p>
      </div>
      <div className="hero-image">
        {image ? (
          <Image
            data={image}
            sizes="(min-width: 900px) 60vw, 100vw"
            alt={image.altText || collection.title}
            loading="eager"
          />
        ) : null}
        {collection ? (
          <Link className="hero-collection-link" to={localePath(`/collections/${collection.handle}`)}>
            <span>{collection.title}</span><span aria-hidden="true">↗</span>
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function RecommendedProducts({products}: {products: Promise<RecommendedProductsQuery | null>}) {
  const localePath = useLocalePath();
  return (
    <section className="recommended-products" aria-labelledby="recommended-products">
      <div className="section-heading">
        <div>
          <p className="eyebrow"><T>On the shortlist</T></p>
          <h2 id="recommended-products"><T>The everyday edit</T></h2>
        </div>
        <Link className="text-link" to={localePath('/collections/all')}>
          <T>Shop all</T><span aria-hidden="true">↗</span>
        </Link>
      </div>
      <Suspense fallback={<div className="products-loading"><T>Finding your next favorites…</T></div>}>
        <Await resolve={products}>
          {(response) => response ? (
            <div className="recommended-products-grid">
              {response.products.nodes.map((product) => <ProductItem key={product.id} product={product} />)}
            </div>
          ) : <p><T>We could not load the collection. Please try again.</T></p>}
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
    handle
  }
  query FeaturedCollection($country: CountryCode, $language: LanguageCode)
    @inContext(country: $country, language: $language) {
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
    products(first: 4, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ...RecommendedProduct
      }
    }
  }
` as const;
