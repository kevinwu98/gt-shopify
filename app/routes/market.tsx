import {redirect} from 'react-router';
import type {Route} from './+types/market';
import {changeMarket} from '~/lib/markets.server';

export function loader() {
  return redirect('/');
}

export async function action({request, context}: Route.ActionArgs) {
  return changeMarket(request, context);
}
