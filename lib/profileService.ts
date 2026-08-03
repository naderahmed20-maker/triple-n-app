import {
    supabase,
} from './supabase';

export type UserProfile = {
  id: string;

  first_name: string;

  gender: string;

  birth_date: string;
};

export async function getMyProfile() {
  const {
    data:
      sessionData,
  } =
    await supabase
      .auth
      .getSession();

  const user =
    sessionData
      .session
      ?.user;

  if (!user) {
    return null;
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        'profiles'
      )
      .select('*')
      .eq(
        'id',
        user.id
      )
      .maybeSingle();

  if (error) {
    throw new Error(
      error.message
    );
  }

  return data as
    | UserProfile
    | null;
}

export async function saveMyProfile({
  firstName,
  gender,
  birthDate,
}: {
  firstName: string;

  gender: string;

  birthDate: string;
}) {
  const {
    data:
      sessionData,
  } =
    await supabase
      .auth
      .getSession();

  const user =
    sessionData
      .session
      ?.user;

  if (!user) {
    throw new Error(
      'Login required'
    );
  }

  const {
    error,
  } =
    await supabase
      .from(
        'profiles'
      )
      .upsert({
        id:
          user.id,

        first_name:
          firstName.trim(),

        gender,

        birth_date:
          birthDate,

        updated_at:
          new Date()
            .toISOString(),
      });

  if (error) {
    throw new Error(
      error.message
    );
  }
}