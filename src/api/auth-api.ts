import {
  Body,
  Controller,
  Route,
  Tags,
  Response,
  Post,
  TsoaResponse,
  Res,
  Request,
  NoSecurity,
  Security,
} from 'tsoa';
import { DynamoDBServiceException } from '@aws-sdk/client-dynamodb';
import { DynamoDBExceptionName } from 'ddb-table';
import { v4 as uuid } from 'uuid';
import { LoginResponse } from './responses';
import { LoginRequest } from './requests';
import { UserIdentityTable } from '../db/user-identity';
import { HttpError } from './internal/errors';
import { preventOverwrite } from '../db/base';
import { JwtService } from '../services/JwtService';
import { generateJwt, EnrichedRequest } from '../auth';

@Route('/auth')
@Tags('Auth Api')
export class AuthApi extends Controller {
  userIdentityTable: UserIdentityTable;

  jwtService: JwtService;

  constructor() {
    super();
    this.userIdentityTable = new UserIdentityTable();
    this.jwtService = new JwtService();
  }

  @Post('/login')
  @Response<LoginResponse, { 'set-cookie'?: string[] }>(200)
  @NoSecurity()
  public async login(
    @Body() request: LoginRequest,
    @Request() httpRequest: EnrichedRequest,
    @Res()
    res: TsoaResponse<200, LoginResponse, { 'set-cookie'?: string[] }>,
  ): Promise<LoginResponse> {
    const hashKey = this.userIdentityTable.hashKey(request.email);
    // Use an empty range key to enforce uniqueness on the hash key
    const rangeKey = this.userIdentityTable.rangeKey('');

    // This will write to the User Identity Table
    // In EventApi, it will watch for INSERT events on the table to handle
    // other asynchronous onboarding events, such as subscribing to SNS topics
    try {
      await this.userIdentityTable
        .put({
          hashKey,
          rangeKey,
          uuid: uuid(),
          email: request.email,
        })
        .exec(preventOverwrite());
    } catch (err) {
      if (
        (err as DynamoDBServiceException)?.name !==
        DynamoDBExceptionName.ConditionalCheckFailedException
      ) {
        throw err;
      }
    }

    const { Item } = await this.userIdentityTable
      .get(hashKey, rangeKey)
      .exec({ ConsistentRead: true });

    if (!Item) {
      // An example on how to throw an error
      throw new HttpError(404, 'Not Found');
    }

    const { newToken, newSetCookies } = await generateJwt(
      Item,
      httpRequest.certsUrl,
      request.remember,
    );

    let response: LoginResponse = {
      uuid: Item.uuid!,
      email: Item.email!,
      token: request.remember ? undefined : newToken,
    };

    if (request.remember) {
      response = res(200, response, { 'set-cookie': newSetCookies });
    }

    return response;
  }

  @Post('/logout')
  @Response<void, { 'set-cookie'?: string[] }>(204)
  @Security('jwt')
  public async logout(
    @Request() httpRequest: EnrichedRequest,
    @Res()
    res: TsoaResponse<204, void>,
  ): Promise<void> {
    // setting remember to false will create cookies which will expire immediately
    const { newSetCookies } = await generateJwt(
      httpRequest.user!,
      httpRequest.certsUrl,
      false,
    );
    return res(204, undefined, { 'set-cookie': newSetCookies });
  }
}
