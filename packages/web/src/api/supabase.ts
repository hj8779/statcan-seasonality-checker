import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config'

export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
