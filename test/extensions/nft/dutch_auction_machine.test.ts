import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { deployMockContract } from '@ethereum-waffle/mock-contract';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import * as helpers from '@nomicfoundation/hardhat-network-helpers';

import jbDirectory from '../../../artifacts/contracts/JBDirectory.sol/JBDirectory.json';
import jbTerminal from '../../../artifacts/contracts/abstract/JBPayoutRedemptionPaymentTerminal.sol/JBPayoutRedemptionPaymentTerminal.json';

describe('DutchAuctionMachine tests', () => {
    const jbxJbTokensEth = '0x000000000000000000000000000000000000EEEe';

    let deployer: SignerWithAddress;
    let accounts: SignerWithAddress[];

    let directory;
    let terminal: any;

    let basicToken: any;
    let dutchAuctionMachine: any;

    const basicBaseUri = 'ipfs://hidden';
    const basicBaseUriRevealed = 'ipfs://revealed/';
    const basicContractUri = 'ipfs://metadata';
    const basicProjectId = 99;
    const basicUnitPrice = ethers.utils.parseEther('0.001');
    const basicMaxSupply = 20;
    const basicMintAllowance = 2
    let basicMintPeriodStart: number;
    let basicMintPeriodEnd: number;

    before('Initialize accounts', async () => {
        [deployer, ...accounts] = await ethers.getSigners();
    });

    before('Setup JBX components', async () => {
        directory = await deployMockContract(deployer, jbDirectory.abi);
        terminal = await deployMockContract(deployer, jbTerminal.abi);

        await terminal.mock.pay.returns(0);
        await directory.mock.isTerminalOf.withArgs(basicProjectId, terminal.address).returns(true);
        await directory.mock.primaryTerminalOf.withArgs(basicProjectId, jbxJbTokensEth).returns(terminal.address);
    });

    before('Initialize NFT', async () => {
        const basicName = 'Test NFT'
        const basicSymbol = 'NFT';

        const now = await helpers.time.latest();
        basicMintPeriodStart = Math.floor(now + 60 * 60);
        basicMintPeriodEnd = Math.floor(now + 24 * 60 * 60);

        const nfTokenFactory = await ethers.getContractFactory('NFToken');
        basicToken = await nfTokenFactory
            .connect(deployer)
            .deploy(
                {
                    name: basicName,
                    symbol: basicSymbol,
                    baseUri: basicBaseUri,
                    contractUri: basicContractUri,
                    maxSupply: basicMaxSupply,
                    unitPrice: basicUnitPrice,
                    mintAllowance: basicMintAllowance
                },
                {
                    jbxDirectory: ethers.constants.AddressZero,
                    jbxProjects: ethers.constants.AddressZero,
                    jbxOperatorStore: ethers.constants.AddressZero
                },
                ethers.constants.AddressZero
            );
        await basicToken.connect(deployer).updateMintPeriod(basicMintPeriodStart, basicMintPeriodEnd);
    });

    before('Initialize Auction Machine', async () => {
        const auctionCap = 10;
        const auctionDuration = 60 * 60;
        const periodDuration = 600;
        const priceMultiplier = 6;

        const dutchAuctionMachineFactory = await ethers.getContractFactory('DutchAuctionMachine');
        dutchAuctionMachine = await dutchAuctionMachineFactory.connect(deployer).deploy();
        await dutchAuctionMachine.deployed();

        await expect(dutchAuctionMachine.connect(accounts[0]).initialize(auctionCap, auctionDuration, periodDuration, priceMultiplier, basicProjectId, directory.address, basicToken.address, deployer.address))
            .to.be.reverted;

        await dutchAuctionMachine.initialize(auctionCap, auctionDuration, periodDuration, priceMultiplier, basicProjectId, directory.address, basicToken.address, deployer.address);

        await expect(dutchAuctionMachine.connect(deployer).initialize(auctionCap, auctionDuration, periodDuration, priceMultiplier, basicProjectId, directory.address, basicToken.address, deployer.address))
            .to.be.reverted;

        await basicToken.connect(deployer).addMinter(dutchAuctionMachine.address);
    });

    it('Create first auction by placing a valid bid', async () => {
        expect(await basicToken.totalSupply()).to.equal(0);

        await dutchAuctionMachine.connect(accounts[0]).bid({ value: basicUnitPrice });

        expect(await basicToken.totalSupply()).to.equal(1);
        expect(await basicToken.balanceOf(dutchAuctionMachine.address)).to.equal(1);
    });

    it('Increase bid', async () => {
        expect(await dutchAuctionMachine.timeLeft()).to.be.greaterThan(0);

        await dutchAuctionMachine.connect(accounts[1]).bid({ value: basicUnitPrice.mul(2) });
    });

    it('Complete auction', async () => {
        await expect(dutchAuctionMachine.settle())
            .to.be.revertedWithCustomError(dutchAuctionMachine, 'AUCTION_ACTIVE');

        const now = await helpers.time.latest();
        const remaining = await dutchAuctionMachine.timeLeft();
        await helpers.time.increaseTo(remaining.add(now).add(60));

        expect(await dutchAuctionMachine.timeLeft()).to.equal(0);
        await expect(dutchAuctionMachine.bid({ value: basicUnitPrice.mul(4) }))
            .to.be.revertedWithCustomError(dutchAuctionMachine, 'AUCTION_ENDED');
        await dutchAuctionMachine.settle();

        expect(await basicToken.totalSupply()).to.equal(2);
        expect(await basicToken.balanceOf(dutchAuctionMachine.address)).to.equal(1);
        expect(await basicToken.balanceOf(accounts[1].address)).to.equal(1);
    });

    it('Complete auction before expiration', async () => {
        await dutchAuctionMachine.connect(accounts[0]).bid({ value: basicUnitPrice.mul(7) });

        await dutchAuctionMachine.settle();

        expect(await basicToken.totalSupply()).to.equal(3);
        expect(await basicToken.balanceOf(dutchAuctionMachine.address)).to.equal(1);
        expect(await basicToken.balanceOf(accounts[0].address)).to.equal(1);
    });

    it('Place bids', async () => {
        await expect(dutchAuctionMachine.connect(accounts[0]).bid({ value: basicUnitPrice.div(2) })).to.be.reverted;
        await expect(dutchAuctionMachine.connect(accounts[0]).bid({ value: basicUnitPrice.mul(2) })).not.to.be.reverted;
        await expect(dutchAuctionMachine.connect(accounts[0]).bid({ value: basicUnitPrice.mul(2) })).to.be.reverted;
    });

    it('Check price', async () => {
        const auctionDuration = 60 * 60;
        const periodDuration = 600;
        const priceMultiplier = 6;
        const maxPrice = basicUnitPrice.mul(priceMultiplier);

        let now = await helpers.time.latest();
        let price = (await dutchAuctionMachine.currentPrice()) as BigNumber;
        expect(price).to.equal(maxPrice);

        const periodPriceDifference = maxPrice.sub(basicUnitPrice).div(Math.floor(auctionDuration / periodDuration))
        await helpers.time.increaseTo(now + periodDuration + 10);
        price = (await dutchAuctionMachine.currentPrice()) as BigNumber;
        expect(price).to.equal(maxPrice.sub(periodPriceDifference));
    });

    it('Fail to transfer pending auction token', async () => {
        const currentAuctionToken = await dutchAuctionMachine.currentTokenId();

        await expect(dutchAuctionMachine.connect(accounts[0]).recoverToken(accounts[2].address, 2))
            .to.be.revertedWith('Ownable: caller is not the owner');
        await expect(dutchAuctionMachine.connect(deployer).recoverToken(accounts[2].address, currentAuctionToken))
            .to.be.revertedWithCustomError(dutchAuctionMachine, 'AUCTION_ACTIVE');

        const now = await helpers.time.latest();
        const remaining = await dutchAuctionMachine.timeLeft();
        await helpers.time.increaseTo(remaining.add(now).add(60));

        await dutchAuctionMachine.settle();
    });

    it('Transfer owned token', async () => {
        const currentAuctionToken = await dutchAuctionMachine.currentTokenId();

        const now = await helpers.time.latest();
        const remaining = await dutchAuctionMachine.timeLeft();
        await helpers.time.increaseTo(remaining.add(now).add(60));

        await dutchAuctionMachine.settle();

        await dutchAuctionMachine.connect(deployer).recoverToken(accounts[2].address, currentAuctionToken);
        expect(await basicToken.balanceOf(dutchAuctionMachine.address)).to.equal(1);
        expect(await basicToken.balanceOf(accounts[2].address)).to.equal(1);
    });
});

// npx hardhat test test/extensions/nft/dutch_auction_machine.test.ts
