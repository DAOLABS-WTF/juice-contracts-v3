import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { smock } from '@defi-wonderland/smock';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import * as helpers from '@nomicfoundation/hardhat-network-helpers';

import jbDirectory from '../../../artifacts/contracts/JBDirectory.sol/JBDirectory.json';
import jbTerminal from '../../../artifacts/contracts/abstract/JBPayoutRedemptionPaymentTerminal.sol/JBPayoutRedemptionPaymentTerminal.json';
import iQuoter from '../../../artifacts/contracts/extensions/NFT/components/BaseNFT.sol/IQuoter.json';

describe('NFToken tests', () => {
    const jbxJbTokensEth = '0x000000000000000000000000000000000000EEEe';

    let deployer: SignerWithAddress;
    let accounts: SignerWithAddress[];

    let directory: any;
    let terminal: any;
    let uniswapQuoter: any;

    let nfTokenFactory: any;
    let basicToken: any;
    const basicBaseUri = 'ipfs://hidden';
    const basicBaseUriRevealed = 'ipfs://revealed/';
    const basicContractUri = 'ipfs://metadata';
    const basicProjectId = 99;
    const basicUnitPrice = ethers.utils.parseEther('0.001');
    const basicMaxSupply = 20;
    const basicMintAllowance = 2;
    let basicMintPeriodStart: number;
    let basicMintPeriodEnd: number;

    before('Initialize accounts', async () => {
        [deployer, ...accounts] = await ethers.getSigners();
    });

    before('Mock related contracts', async () => {
        directory = await smock.fake(jbDirectory.abi);
        terminal = await smock.fake(jbTerminal.abi);
        uniswapQuoter = await smock.fake(iQuoter.abi, { address: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6' });

        await terminal.pay.returns(0);
        await directory.isTerminalOf.whenCalledWith(basicProjectId, terminal.address).returns(true);
        await directory.primaryTerminalOf.whenCalledWith(basicProjectId, jbxJbTokensEth).returns(terminal.address);
        uniswapQuoter.quoteExactInputSingle.returns(BigNumber.from('1000000000000000000000'));
    });

    before('Initialize contracts', async () => {
        const basicName = 'Test NFT'
        const basicSymbol = 'NFT';

        const now = await helpers.time.latest();
        basicMintPeriodStart = Math.floor(now + 60 * 60);
        basicMintPeriodEnd = Math.floor(now + 24 * 60 * 60);

        nfTokenFactory = await ethers.getContractFactory('NFToken');
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
                    jbxDirectory: directory.address,
                    jbxProjects: ethers.constants.AddressZero,
                    jbxOperatorStore: ethers.constants.AddressZero,
                },
                ethers.constants.AddressZero
            );
        await basicToken.connect(deployer).updateMintPeriod(basicMintPeriodStart, basicMintPeriodEnd);
    });

    it('Get contract metadata uri', async () => {
        expect(await basicToken.contractURI()).to.equal(basicContractUri);
    });

    it('Fail to mint before mint period start', async () => {
        await expect(basicToken.connect(accounts[0])['mint()']({ value: basicUnitPrice }))
            .to.be.revertedWithCustomError(basicToken, 'MINT_NOT_STARTED');
    });

    it('Mint a token', async () => {
        await helpers.time.increaseTo(basicMintPeriodStart + 10);
        await expect(basicToken.connect(accounts[0])['mint()']({ value: basicUnitPrice.sub(1000) }))
            .to.be.revertedWithCustomError(basicToken, 'INCORRECT_PAYMENT');

        expect(await basicToken.getMintPrice(accounts[0].address)).to.equal(basicUnitPrice);

        await basicToken.connect(accounts[0])['mint()']({ value: basicUnitPrice });
        await basicToken.connect(accounts[4])['mint()']({ value: basicUnitPrice });
        expect(await basicToken.balanceOf(accounts[0].address)).to.equal(1);
    });

    it('Get token uri', async () => {
        expect(await basicToken.tokenURI(1)).to.equal(basicBaseUri);

        const currentSupply = (await basicToken.totalSupply() as BigNumber).toNumber();
        expect(await basicToken.tokenURI(currentSupply + 1)).to.equal('');
    });

    it('Reveal token, get actual token uri', async () => {
        await expect(basicToken.connect(accounts[0]).setBaseURI(basicBaseUriRevealed, true)).to.be.reverted;

        await basicToken.connect(deployer).removeRevealer(deployer.address);
        await expect(basicToken.connect(deployer).setBaseURI(basicBaseUriRevealed, true)).to.be.reverted;

        await basicToken.connect(deployer).addRevealer(deployer.address);
        await basicToken.connect(deployer).setBaseURI(basicBaseUriRevealed, true);

        const tokenId = 1;
        expect(await basicToken.tokenURI(tokenId)).to.equal(`${basicBaseUriRevealed}${tokenId}`);

        await expect(basicToken.connect(deployer).setBaseURI(basicBaseUriRevealed, false))
            .to.be.revertedWithCustomError(basicToken, 'ALREADY_REVEALED');
    });

    it('Update mint price', async () => {
        await expect(basicToken.connect(accounts[0]).updateUnitPrice(basicUnitPrice.mul(2))).to.be.reverted;

        await basicToken.connect(deployer).updateUnitPrice(basicUnitPrice.mul(2));

        expect(await basicToken.unitPrice()).to.equal(basicUnitPrice.mul(2));

        await basicToken.connect(deployer).updateUnitPrice(basicUnitPrice);
    });

    it('Set royalty rate', async () => {
        await expect(basicToken.connect(accounts[0]).setRoyalties(accounts[0].address, 5_000)).to.be.reverted;

        await expect(basicToken.connect(deployer).setRoyalties(deployer.address, 15_000))
            .to.be.revertedWithCustomError(basicToken, 'INVALID_RATE');

        await basicToken.connect(deployer).setRoyalties(deployer.address, 5_000);

        let royalties = await basicToken.royaltyInfo(1, basicUnitPrice);
        expect(royalties.receiver).to.equal(ethers.constants.AddressZero);
        expect(royalties.royaltyAmount).to.equal(BigNumber.from(0));

        const currentSupply = (await basicToken.totalSupply() as BigNumber).toNumber();
        royalties = await basicToken.royaltyInfo(currentSupply + 1, basicUnitPrice);
        expect(royalties.receiver).to.equal(deployer.address);
        expect(royalties.royaltyAmount).to.equal(BigNumber.from('500000000000000'));
    });

    it('Update mint period', async () => {
        const currentTime = await helpers.time.latest();
        const start = currentTime - 1000;
        const end = currentTime - 100;

        await expect(basicToken.connect(accounts[0]).updateMintPeriod(start, end)).to.be.reverted;
        await basicToken.connect(deployer).updateMintPeriod(start, end);

        expect(await basicToken.mintPeriodStart()).to.equal(start);
        expect(await basicToken.mintPeriodEnd()).to.equal(end);
    });

    it('Fail mint after expiration', async () => {
        await expect(basicToken.connect(accounts[4])['mint()']({ value: basicUnitPrice }))
            .to.be.revertedWithCustomError(basicToken, 'MINT_CONCLUDED');

        await basicToken.connect(deployer).updateMintPeriod(basicMintPeriodStart + 1000, basicMintPeriodEnd + 1000);
        await helpers.time.increaseTo(basicMintPeriodStart + 1010);
    });

    it('Set provenance hash', async () => {
        const provenanceHash = '0xc0ffee';
        await expect(basicToken.connect(accounts[0]).setProvenanceHash(provenanceHash)).to.be.reverted;
        await basicToken.connect(deployer).setProvenanceHash(provenanceHash);
        await expect(basicToken.connect(deployer).setProvenanceHash('0x0decaf')).to.be.revertedWithCustomError(basicToken, 'PROVENANCE_REASSIGNMENT');

        expect(await basicToken.provenanceHash()).to.equal(provenanceHash);
    });

    it('Admin mints to an address', async () => {
        await expect(basicToken.connect(accounts[0]).mintFor(accounts[0].address)).to.be.reverted;
        await basicToken.connect(deployer).mintFor(accounts[1].address);

        expect(await basicToken.totalSupply()).to.equal(3);
        expect(await basicToken.balanceOf(accounts[1].address)).to.equal(1);
    });

    it('Pause minting', async () => {
        await expect(basicToken.connect(accounts[0]).setPause(true)).to.be.reverted;
        await basicToken.connect(deployer).setPause(true);

        await expect(basicToken.connect(accounts[0])['mint()']({ value: basicUnitPrice }))
            .to.be.revertedWithCustomError(basicToken, 'MINTING_PAUSED');
        await expect(basicToken.connect(accounts[0])['mint()']({ value: basicUnitPrice }))
            .to.be.revertedWithCustomError(basicToken, 'MINTING_PAUSED');

        await basicToken.connect(deployer).setPause(false);
    });

    it('Manage minter role', async () => {
        await expect(basicToken.connect(accounts[0]).mintFor(accounts[0].address)).to.be.reverted;
        await basicToken.connect(deployer).addMinter(accounts[0].address);

        await expect(basicToken.connect(accounts[0]).mintFor(accounts[1].address)).not.to.be.reverted;
        expect(await basicToken.balanceOf(accounts[1].address)).to.equal(2);

        await basicToken.connect(deployer).removeMinter(accounts[0].address);
        await expect(basicToken.connect(accounts[0]).mintFor(accounts[0].address)).to.be.reverted;
    });

    it('Manage minter role', async () => {
        await expect(basicToken.connect(accounts[0]).setContractURI('ipfs://contract_metadata')).to.be.reverted;
        await expect(basicToken.connect(deployer).setContractURI('ipfs://contract_metadata')).not.to.be.reverted
    });

    it('Manage minter role', async () => {
        expect(await basicToken.supportsInterface('0x2a55205a')).to.equal(true);
    });

    it('Account reached mint allowance', async () => {
        await expect(basicToken.connect(accounts[1])['mint()']({ value: basicUnitPrice }))
            .to.be.revertedWithCustomError(basicToken, 'ALLOWANCE_EXHAUSTED');
    });

    it('Set OperatorFilter', async () => {
        const operatorFilterFactory = await ethers.getContractFactory('OperatorFilter');
        const operatorFilter = await operatorFilterFactory.connect(deployer).deploy();

        await expect(basicToken.connect(accounts[0]).updateOperatorFilter(operatorFilter.address)).to.be.reverted;
        await expect(basicToken.connect(deployer).updateOperatorFilter(operatorFilter.address)).not.to.be.reverted;

        await expect(operatorFilter.connect(accounts[0]).registerAddress(accounts[5].address, true)).to.be.reverted;
        await operatorFilter.connect(deployer).registerAddress(accounts[5].address, true);

        await expect(basicToken.connect(accounts[5])['mint()']({ value: basicUnitPrice }))
            .to.be.revertedWithCustomError(basicToken, 'CALLER_BLOCKED');

        await operatorFilter.connect(deployer).registerAddress(accounts[5].address, false);

        await expect(basicToken.connect(accounts[5])['mint()']({ value: basicUnitPrice }))
            .not.to.be.reverted;

        const tokenId = await basicToken.totalSupply();
        await operatorFilter.connect(deployer).registerAddress(accounts[5].address, true);
        await expect(basicToken.connect(accounts[5]).transferFrom(accounts[5].address, accounts[4].address, tokenId))
            .to.be.revertedWithCustomError(basicToken, 'CALLER_BLOCKED');
    });

    it('Mint failure due to exhausted supply', async () => {
        let currentSupply = ((await basicToken.totalSupply()) as BigNumber).toNumber();
        while (currentSupply < basicMaxSupply) {
            await basicToken.connect(deployer).mintFor(accounts[3].address);
            currentSupply++;
        }

        await expect(basicToken.connect(deployer).mintFor(accounts[3].address))
            .to.be.revertedWithCustomError(basicToken, 'SUPPLY_EXHAUSTED');

        await expect(basicToken.connect(accounts[4])['mint()']({ value: basicUnitPrice }))
            .to.be.revertedWithCustomError(basicToken, 'SUPPLY_EXHAUSTED');
        await expect(basicToken.connect(accounts[4])['mint()']({ value: basicUnitPrice }))
            .to.be.revertedWithCustomError(basicToken, 'SUPPLY_EXHAUSTED');
    });

    it('Individual CID Token', async () => {
        const cid = ethers.utils.base58.decode('QmWmyoMoctfbAaiEs2G46gpeUmhqFRDW6KWo64y5r581Vz');

        const basicName = 'Test NFT'
        const basicSymbol = 'NFT';

        const traitTokenFactory = await ethers.getContractFactory('TraitToken');
        const traitToken = await traitTokenFactory.connect(deployer).deploy();
        await traitToken.deployed();

        await expect(traitToken.connect(accounts[0]).initialize(
            deployer.address,
            basicName,
            basicSymbol,
            basicBaseUri,
            basicContractUri,
            basicMaxSupply,
            basicUnitPrice,
            basicMintAllowance,
            0,
            0
        )).to.be.reverted;

        await expect(traitToken.connect(deployer).initialize(
            deployer.address,
            basicName,
            basicSymbol,
            basicBaseUri,
            basicContractUri,
            basicMaxSupply,
            basicUnitPrice,
            basicMintAllowance,
            0,
            0
        )).not.to.be.reverted;

        await expect(traitToken.connect(deployer).initialize(
            deployer.address,
            basicName,
            basicSymbol,
            basicBaseUri,
            basicContractUri,
            basicMaxSupply,
            basicUnitPrice,
            basicMintAllowance,
            0,
            0
        )).to.be.reverted;

        await expect(traitToken.setTokenAsset(1, '0x' + Buffer.from(cid.slice(2)).toString('hex')))
            .to.be.revertedWithCustomError(traitToken, 'NOT_MINTED');
        await traitToken.connect(accounts[4])['mint()']({ value: basicUnitPrice });
        await expect(traitToken.setTokenAsset(1, '0x' + Buffer.from(cid.slice(2)).toString('hex')));
        await expect(traitToken.setTokenAsset(1, '0x' + Buffer.from(cid.slice(2)).toString('hex')))
            .to.be.revertedWithCustomError(traitToken, 'CID_REASSIGNMENT');
        expect(await traitToken.tokenURI(1)).to.equal(`ipfs://QmWmyoMoctfbAaiEs2G46gpeUmhqFRDW6KWo64y5r581Vz`);
    });

    it('Non-sequential token ids', async () => {
        const basicName = 'Test NFT'
        const basicSymbol = 'NFT';

        const now = await helpers.time.latest();
        basicMintPeriodStart = Math.floor(now + 60 * 60);
        basicMintPeriodEnd = Math.floor(now + 24 * 60 * 60);

        nfTokenFactory = await ethers.getContractFactory('NFToken');
        const nonSequentialToken = await nfTokenFactory
            .connect(deployer)
            .deploy(
                {
                    name: basicName,
                    symbol: basicSymbol,
                    baseUri: basicBaseUri,
                    contractUri: basicContractUri,
                    maxSupply: 10_000,
                    unitPrice: basicUnitPrice,
                    mintAllowance: 10
                },
                {
                    jbxDirectory: directory.address,
                    jbxProjects: ethers.constants.AddressZero,
                    jbxOperatorStore: ethers.constants.AddressZero,
                },
                ethers.constants.AddressZero
            );

        await expect(nonSequentialToken.connect(accounts[0]).setRandomizedMint(true)).to.be.reverted;

        await nonSequentialToken.connect(accounts[0])['mint()']({ value: basicUnitPrice });
        expect(await nonSequentialToken.ownerOf(1)).to.equal(accounts[0].address);

        await nonSequentialToken.connect(deployer).setRandomizedMint(true);

        const tx = await nonSequentialToken.connect(accounts[0])['mint()']({ value: basicUnitPrice });
        const receipt = await tx.wait();
        const [AddressZero, owner, tokenId] = receipt.events.filter(e => e.event === 'Transfer')[0].args;

        expect(await nonSequentialToken.ownerOf(2)).to.equal(ethers.constants.AddressZero);
        expect(await nonSequentialToken.ownerOf(tokenId)).to.equal(accounts[0].address);
        expect(tokenId).not.to.equal(await nonSequentialToken.totalSupply());

        await nonSequentialToken.connect(deployer).setRandomizedMint(false);

        await nonSequentialToken.connect(accounts[0])['mint()']({ value: basicUnitPrice });
        expect(await nonSequentialToken.ownerOf(2)).to.equal(ethers.constants.AddressZero);
    });

    it('Simplest feature set mint', async () => {
        const simpleToken = await nfTokenFactory
            .connect(deployer)
            .deploy(
                {
                    name: 'Simple NFT',
                    symbol: 'SNFT',
                    baseUri: basicBaseUri,
                    contractUri: basicContractUri,
                    maxSupply: 10_000,
                    unitPrice: basicUnitPrice,
                    mintAllowance: 10
                },
                {
                    jbxDirectory: directory.address,
                    jbxProjects: ethers.constants.AddressZero,
                    jbxOperatorStore: ethers.constants.AddressZero,
                },
                ethers.constants.AddressZero
            );

        await simpleToken.connect(deployer).setRoyalties(deployer.address, 500);

        let totalGas = BigNumber.from(0);
        const samples = 10;
        for (let i = 0; i < samples; i++) {
            const tx = await simpleToken.connect(accounts[0])['mint()']({ value: basicUnitPrice });
            const receipt = await tx.wait();
            totalGas = totalGas.add(receipt.gasUsed);
        }

        console.log(`minimum expected gas: ${totalGas.div(samples)}`);
    });
});

// npx hardhat test test/extensions/nft/nftoken.test.ts
